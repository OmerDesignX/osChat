#define NAPI_VERSION 8
#include <node_api.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CGWindow.h>

#include <unistd.h>

static NSArray<NSString *> *BlockedTargets() {
  return @[
    @"terminal", @"iterm", @"powershell", @"credential",
    @"keychain access", @"1password", @"bitwarden", @"authenticator",
    @"system settings", @"system preferences", @"activity monitor",
    @"security"
  ];
}

static napi_value Throw(napi_env env, NSString *message) {
  napi_throw_error(env, nullptr, message.UTF8String);
  return nullptr;
}

static napi_value StringValue(napi_env env, NSString *value) {
  napi_value result;
  napi_create_string_utf8(env, value.UTF8String, NAPI_AUTO_LENGTH, &result);
  return result;
}

static NSString *ArgumentString(napi_env env, napi_value value,
                                NSUInteger limit) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok)
    return @"";
  size = MIN(size, limit);
  NSMutableData *data = [NSMutableData dataWithLength:size + 1];
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, (char *)data.mutableBytes,
                                 size + 1, &written) != napi_ok)
    return @"";
  NSString *result = [[NSString alloc]
      initWithBytes:data.bytes
             length:written
           encoding:NSUTF8StringEncoding];
  return [result ?: @"" stringByReplacingOccurrencesOfString:@"\0"
                                                   withString:@""];
}

static napi_value JsonValue(napi_env env, id value) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value
                                                 options:0
                                                   error:&error];
  if (!data)
    return Throw(env, error.localizedDescription ?: @"Unable to encode output");
  NSString *json = [[NSString alloc] initWithData:data
                                          encoding:NSUTF8StringEncoding];
  return StringValue(env, json ?: @"null");
}

static BOOL AccessibilityReady(BOOL prompt) {
  NSString *key = (__bridge NSString *)kAXTrustedCheckOptionPrompt;
  return AXIsProcessTrustedWithOptions(
      (__bridge CFDictionaryRef)@{key : @(prompt)});
}

static id CopyAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess)
    return nil;
  return CFBridgingRelease(value);
}

static NSString *StringAttribute(AXUIElementRef element, CFStringRef name) {
  id value = CopyAttribute(element, name);
  if ([value isKindOfClass:[NSString class]]) return value;
  if ([value isKindOfClass:[NSNumber class]])
    return [(NSNumber *)value stringValue];
  return nil;
}

static NSArray *Children(AXUIElementRef element) {
  id value = CopyAttribute(element, kAXChildrenAttribute);
  return [value isKindOfClass:[NSArray class]] ? value : @[];
}

static NSDictionary *Bounds(AXUIElementRef element) {
  id position = CopyAttribute(element, kAXPositionAttribute);
  id sizeValue = CopyAttribute(element, kAXSizeAttribute);
  if (!position || !sizeValue ||
      CFGetTypeID((__bridge CFTypeRef)position) != AXValueGetTypeID() ||
      CFGetTypeID((__bridge CFTypeRef)sizeValue) != AXValueGetTypeID())
    return nil;
  CGPoint point = CGPointZero;
  CGSize size = CGSizeZero;
  if (!AXValueGetValue((__bridge AXValueRef)position,
                       (AXValueType)kAXValueCGPointType, &point) ||
      !AXValueGetValue((__bridge AXValueRef)sizeValue,
                       (AXValueType)kAXValueCGSizeType, &size))
    return nil;
  return @{
    @"x" : @(point.x),
    @"y" : @(point.y),
    @"width" : @(size.width),
    @"height" : @(size.height)
  };
}

static NSDictionary *Snapshot(AXUIElementRef element) {
  NSString *role = StringAttribute(element, kAXRoleAttribute) ?: @"";
  NSString *subrole = StringAttribute(element, kAXSubroleAttribute) ?: @"";
  NSString *roleDescription =
      StringAttribute(element, kAXRoleDescriptionAttribute) ?: @"";
  NSString *title = StringAttribute(element, kAXTitleAttribute) ?: @"";
  NSString *description =
      StringAttribute(element, kAXDescriptionAttribute) ?: @"";
  NSString *identifier =
      StringAttribute(element, kAXIdentifierAttribute) ?: @"";
  NSString *help = StringAttribute(element, kAXHelpAttribute) ?: @"";
  NSString *placeholder =
      StringAttribute(element, kAXPlaceholderValueAttribute) ?: @"";
  NSString *value = StringAttribute(element, kAXValueAttribute) ?: @"";
  NSString *label = role;
  for (NSString *candidate in
       @[ title, description, placeholder, help, identifier, roleDescription,
          value ]) {
    if ([candidate stringByTrimmingCharactersInSet:
                       NSCharacterSet.whitespaceAndNewlineCharacterSet]
            .length) {
      label = candidate;
      break;
    }
  }
  id enabledValue = CopyAttribute(element, kAXEnabledAttribute);
  NSMutableDictionary *item = [@{
    @"role" : role,
    @"subrole" : subrole,
    @"roleDescription" : roleDescription,
    @"title" : [title substringToIndex:MIN(title.length, 300u)],
    @"description" :
        [description substringToIndex:MIN(description.length, 300u)],
    @"placeholder" :
        [placeholder substringToIndex:MIN(placeholder.length, 300u)],
    @"help" : [help substringToIndex:MIN(help.length, 300u)],
    @"label" : [label substringToIndex:MIN(label.length, 300u)],
    @"identifier" :
        [identifier substringToIndex:MIN(identifier.length, 200u)],
    @"enabled" : @(![enabledValue isKindOfClass:[NSNumber class]] ||
                    [(NSNumber *)enabledValue boolValue])
  } mutableCopy];
  NSDictionary *frame = Bounds(element);
  if (frame) item[@"bounds"] = frame;
  return item;
}

static NSString *NormalizedControlText(NSString *value) {
  NSString *lowered = (value ?: @"").lowercaseString;
  NSMutableString *normalized = [NSMutableString string];
  BOOL lastWasSpace = YES;
  NSCharacterSet *alphaNumeric = NSCharacterSet.alphanumericCharacterSet;
  for (NSUInteger index = 0; index < lowered.length; index++) {
    unichar character = [lowered characterAtIndex:index];
    if ([alphaNumeric characterIsMember:character]) {
      [normalized appendFormat:@"%C", character];
      lastWasSpace = NO;
    } else if (!lastWasSpace) {
      [normalized appendString:@" "];
      lastWasSpace = YES;
    }
  }
  return [normalized
      stringByTrimmingCharactersInSet:
          NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

static NSString *SemanticControlText(NSDictionary *item) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSString *key in
       @[ @"label", @"title", @"description", @"placeholder", @"help",
          @"identifier", @"roleDescription", @"role", @"subrole" ]) {
    NSString *value = item[key];
    if ([value isKindOfClass:[NSString class]] && value.length)
      [parts addObject:value];
  }
  NSString *role =
      [NSString stringWithFormat:@"%@ %@", item[@"role"] ?: @"",
                                 item[@"subrole"] ?: @""]
          .lowercaseString;
  if ([role containsString:@"searchfield"])
    [parts addObject:@"search search field text field input"];
  else if ([role containsString:@"textfield"] ||
           [role containsString:@"textarea"])
    [parts addObject:@"text text field input editor"];
  if ([role containsString:@"button"])
    [parts addObject:@"button control"];
  if ([role containsString:@"checkbox"])
    [parts addObject:@"checkbox check box toggle"];
  if ([role containsString:@"menuitem"])
    [parts addObject:@"menu item"];
  if ([role containsString:@"combobox"] ||
      [role containsString:@"popupbutton"])
    [parts addObject:@"combo box dropdown pop up menu"];
  return NormalizedControlText([parts componentsJoinedByString:@" "]);
}

static BOOL AllTermsMatch(NSString *candidate, NSString *wanted) {
  if (!candidate.length || !wanted.length) return NO;
  for (NSString *term in
       [wanted componentsSeparatedByCharactersInSet:
                   NSCharacterSet.whitespaceCharacterSet]) {
    if (term.length && ![candidate containsString:term]) return NO;
  }
  return YES;
}

static NSInteger MatchScore(NSDictionary *item, NSString *wanted) {
  NSString *label = NormalizedControlText(item[@"label"] ?: @"");
  NSString *identifier =
      NormalizedControlText(item[@"identifier"] ?: @"");
  NSString *semantic = SemanticControlText(item);
  if ([label isEqualToString:wanted] || [identifier isEqualToString:wanted])
    return 1000;
  if ([label containsString:wanted] || [identifier containsString:wanted])
    return 900;
  if ([semantic containsString:wanted]) return 800;
  if (AllTermsMatch(semantic, wanted)) return 700;
  return 0;
}

static BOOL ElementCenter(AXUIElementRef element, CGPoint *center) {
  NSDictionary *bounds = Bounds(element);
  if (!bounds) return NO;
  CGFloat width = [bounds[@"width"] doubleValue];
  CGFloat height = [bounds[@"height"] doubleValue];
  if (width <= 0 || height <= 0) return NO;
  center->x = [bounds[@"x"] doubleValue] + width / 2.0;
  center->y = [bounds[@"y"] doubleValue] + height / 2.0;
  return YES;
}

static void ActivateApplication(NSRunningApplication *application) {
  [application activateWithOptions:NSApplicationActivateIgnoringOtherApps];
  usleep(40 * 1000);
}

static BOOL ClickElement(NSRunningApplication *application,
                         AXUIElementRef element) {
  CGPoint point = CGPointZero;
  if (!ElementCenter(element, &point)) return NO;
  ActivateApplication(application);
  CGEventSourceRef source =
      CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return NO;
  CGEventRef move =
      CGEventCreateMouseEvent(source, kCGEventMouseMoved, point,
                              kCGMouseButtonLeft);
  CGEventRef down =
      CGEventCreateMouseEvent(source, kCGEventLeftMouseDown, point,
                              kCGMouseButtonLeft);
  CGEventRef up =
      CGEventCreateMouseEvent(source, kCGEventLeftMouseUp, point,
                              kCGMouseButtonLeft);
  if (move) CGEventPost(kCGHIDEventTap, move);
  if (down) CGEventPost(kCGHIDEventTap, down);
  if (up) CGEventPost(kCGHIDEventTap, up);
  if (move) CFRelease(move);
  if (down) CFRelease(down);
  if (up) CFRelease(up);
  CFRelease(source);
  usleep(30 * 1000);
  return move && down && up;
}

static BOOL PostKeyboardText(NSString *text) {
  CGEventSourceRef source =
      CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return NO;
  CGEventRef selectDown = CGEventCreateKeyboardEvent(source, 0, true);
  CGEventRef selectUp = CGEventCreateKeyboardEvent(source, 0, false);
  if (!selectDown || !selectUp) {
    if (selectDown) CFRelease(selectDown);
    if (selectUp) CFRelease(selectUp);
    CFRelease(source);
    return NO;
  }
  CGEventSetFlags(selectDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(selectUp, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, selectDown);
  CGEventPost(kCGHIDEventTap, selectUp);
  CFRelease(selectDown);
  CFRelease(selectUp);

  const NSUInteger chunkSize = 20;
  for (NSUInteger start = 0; start < text.length; start += chunkSize) {
    NSRange range = NSMakeRange(start, MIN(chunkSize, text.length - start));
    UniChar characters[chunkSize];
    [text getCharacters:characters range:range];
    CGEventRef down = CGEventCreateKeyboardEvent(source, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(source, 0, false);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      CFRelease(source);
      return NO;
    }
    CGEventKeyboardSetUnicodeString(down, range.length, characters);
    CGEventKeyboardSetUnicodeString(up, range.length, characters);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
  }
  CFRelease(source);
  return YES;
}

static BOOL SafeTarget(NSString *target, NSString **error) {
  NSString *lowered = target.lowercaseString;
  for (NSString *blocked in BlockedTargets()) {
    if ([lowered containsString:blocked]) {
      if (error)
        *error = @"Computer Control cannot operate terminals, credential "
                 @"tools, or system security controls";
      return NO;
    }
  }
  return YES;
}

static NSRunningApplication *RunningApplication(NSString *target,
                                                NSString **error) {
  if (!SafeTarget(target, error)) return nil;
  NSArray<NSRunningApplication *> *apps =
      [NSWorkspace.sharedWorkspace.runningApplications
          filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:
          ^BOOL(NSRunningApplication *app, NSDictionary *bindings) {
            return !app.terminated &&
                   app.activationPolicy == NSApplicationActivationPolicyRegular;
          }]];
  NSString *wanted = target.lowercaseString;
  for (NSRunningApplication *app in apps) {
    if ([app.localizedName.lowercaseString isEqualToString:wanted] ||
        [app.bundleIdentifier.lowercaseString isEqualToString:wanted])
      return app;
  }
  NSMutableArray<NSRunningApplication *> *partial = [NSMutableArray array];
  for (NSRunningApplication *app in apps) {
    if ([app.localizedName.lowercaseString containsString:wanted] ||
        [app.bundleIdentifier.lowercaseString containsString:wanted])
      [partial addObject:app];
  }
  if (partial.count == 1) return partial.firstObject;
  if (error)
    *error = partial.count > 1
                 ? @"That application name matches more than one visible app"
                 : @"The requested application is not visible";
  return nil;
}

static NSArray *Elements(NSRunningApplication *application,
                         NSUInteger limit) {
  id root = CFBridgingRelease(
      AXUIElementCreateApplication(application.processIdentifier));
  NSMutableArray<NSDictionary *> *queue =
      [NSMutableArray arrayWithObject:@{ @"element" : root, @"depth" : @0 }];
  NSMutableArray *result = [NSMutableArray array];
  while (queue.count && result.count < limit) {
    NSDictionary *entry = queue.firstObject;
    [queue removeObjectAtIndex:0];
    id elementObject = entry[@"element"];
    AXUIElementRef element = (__bridge AXUIElementRef)elementObject;
    [result addObject:elementObject];
    NSUInteger depth = [entry[@"depth"] unsignedIntegerValue];
    if (depth >= 8) continue;
    NSUInteger count = 0;
    for (id child in Children(element)) {
      if (count++ >= 120) break;
      [queue addObject:@{ @"element" : child, @"depth" : @(depth + 1) }];
    }
  }
  return result;
}

static id MatchingElement(NSRunningApplication *application, NSString *query,
                          NSString **error) {
  NSString *wanted = NormalizedControlText(query);
  if (!wanted.length) {
    if (error) *error = @"Describe the control to use";
    return nil;
  }
  NSArray *all = Elements(application, 400);
  id best = nil;
  NSInteger bestScore = 0;
  NSMutableArray *editable = [NSMutableArray array];
  for (id object in all) {
    AXUIElementRef element = (__bridge AXUIElementRef)object;
    NSDictionary *item = Snapshot(element);
    NSString *role =
        [NSString stringWithFormat:@"%@ %@", item[@"role"] ?: @"",
                                   item[@"subrole"] ?: @""]
            .lowercaseString;
    if ([role containsString:@"textfield"] ||
        [role containsString:@"textarea"])
      [editable addObject:object];
    NSInteger score = MatchScore(item, wanted);
    if (score > bestScore) {
      best = object;
      bestScore = score;
    }
  }
  if (best) return best;
  if (([wanted containsString:@"field"] ||
       [wanted containsString:@"input"] ||
       [wanted containsString:@"search"]) &&
      editable.count == 1)
    return editable.firstObject;
  if (error) *error = @"No accessible control matched that description";
  return nil;
}

static BOOL GetArguments(napi_env env, napi_callback_info info, size_t expected,
                         napi_value *args) {
  size_t argc = expected;
  return napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) == napi_ok &&
         argc >= expected;
}

static napi_value IsTrusted(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    napi_value args[1];
    size_t argc = 1;
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    bool prompt = false;
    if (argc) napi_get_value_bool(env, args[0], &prompt);
    napi_value result;
    napi_get_boolean(env, AccessibilityReady(prompt), &result);
    return result;
  }
}

static napi_value IsScreenCaptureTrusted(napi_env env,
                                         napi_callback_info info) {
  @autoreleasepool {
    napi_value result;
    BOOL trusted = NO;
    if (@available(macOS 10.15, *))
      trusted = CGPreflightScreenCaptureAccess();
    napi_get_boolean(env, trusted, &result);
    return result;
  }
}

static napi_value RequestScreenCaptureAccess(napi_env env,
                                             napi_callback_info info) {
  @autoreleasepool {
    napi_value result;
    BOOL trusted = NO;
    if (@available(macOS 10.15, *))
      trusted = CGRequestScreenCaptureAccess();
    napi_get_boolean(env, trusted, &result);
    return result;
  }
}

static napi_value ListApplications(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    NSMutableArray *result = [NSMutableArray array];
    for (NSRunningApplication *application in
         NSWorkspace.sharedWorkspace.runningApplications) {
      if (application.terminated ||
          application.activationPolicy != NSApplicationActivationPolicyRegular ||
          !application.localizedName)
        continue;
      NSString *ignored = nil;
      if (!SafeTarget(application.localizedName, &ignored)) continue;
      [result addObject:@{
        @"name" : application.localizedName,
        @"bundleIdentifier" : application.bundleIdentifier ?: @"",
        @"pid" : @(application.processIdentifier)
      }];
    }
    return JsonValue(env, result);
  }
}

static napi_value Inspect(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    napi_value args[2];
    if (!GetArguments(env, info, 1, args))
      return Throw(env, @"Choose a visible application first");
    if (!AccessibilityReady(true))
      return Throw(env, @"Allow osCode in System Settings > Privacy & "
                        @"Security > Accessibility, then try again");
    NSString *target = ArgumentString(env, args[0], 160);
    NSString *query = @"";
    if (GetArguments(env, info, 2, args)) query = ArgumentString(env, args[1], 300);
    NSString *error = nil;
    NSRunningApplication *application = RunningApplication(target, &error);
    if (!application) return Throw(env, error);
    NSMutableArray *visible = [NSMutableArray array];
    NSString *wanted = NormalizedControlText(query);
    for (id object in Elements(application, 400)) {
      NSDictionary *item = Snapshot((__bridge AXUIElementRef)object);
      if (wanted.length && MatchScore(item, wanted) == 0)
        continue;
      [visible addObject:item];
      if (visible.count >= 300) break;
    }
    return JsonValue(env, visible);
  }
}

static napi_value Invoke(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    napi_value args[2];
    if (!GetArguments(env, info, 2, args))
      return Throw(env, @"Choose an application and control first");
    if (!AccessibilityReady(true))
      return Throw(env, @"Allow osCode in System Settings > Privacy & "
                        @"Security > Accessibility, then try again");
    NSString *target = ArgumentString(env, args[0], 160);
    NSString *query = ArgumentString(env, args[1], 300);
    NSString *error = nil;
    NSRunningApplication *application = RunningApplication(target, &error);
    if (!application) return Throw(env, error);
    id elementObject = MatchingElement(application, query, &error);
    if (!elementObject) return Throw(env, error);
    AXUIElementRef element = (__bridge AXUIElementRef)elementObject;
    NSString *method = @"accessibility";
    if (AXUIElementPerformAction(element, kAXPressAction) != kAXErrorSuccess) {
      if (!ClickElement(application, element))
        return Throw(env,
                     @"That control could not be activated by Accessibility or "
                      @"the local mouse fallback");
      method = @"mouse";
    }
    return JsonValue(env, @{
      @"action" : @"invoke",
      @"target" : target,
      @"method" : method,
      @"control" : Snapshot(element)
    });
  }
}

static napi_value SetValue(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    napi_value args[3];
    if (!GetArguments(env, info, 3, args))
      return Throw(env, @"Choose an application, field, and text first");
    if (!AccessibilityReady(true))
      return Throw(env, @"Allow osCode in System Settings > Privacy & "
                        @"Security > Accessibility, then try again");
    NSString *target = ArgumentString(env, args[0], 160);
    NSString *query = ArgumentString(env, args[1], 300);
    NSString *text = ArgumentString(env, args[2], 20000);
    NSString *error = nil;
    NSRunningApplication *application = RunningApplication(target, &error);
    if (!application) return Throw(env, error);
    id elementObject = MatchingElement(application, query, &error);
    if (!elementObject) return Throw(env, error);
    AXUIElementRef element = (__bridge AXUIElementRef)elementObject;
    ActivateApplication(application);
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute,
                                 kCFBooleanTrue);
    Boolean settable = false;
    BOOL setDirectly =
        AXUIElementIsAttributeSettable(element, kAXValueAttribute, &settable) ==
            kAXErrorSuccess &&
        settable &&
        AXUIElementSetAttributeValue(element, kAXValueAttribute,
                                     (__bridge CFTypeRef)text) ==
            kAXErrorSuccess;
    NSString *method = @"accessibility";
    if (!setDirectly) {
      if (!ClickElement(application, element) || !PostKeyboardText(text))
        return Throw(env,
                     @"That field could not accept text through Accessibility "
                      @"or the local keyboard fallback");
      method = @"keyboard";
    }
    return JsonValue(env, @{
      @"action" : @"set-value",
      @"target" : target,
      @"method" : method,
      @"control" : Snapshot(element)
    });
  }
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"isTrusted", nullptr, IsTrusted, nullptr, nullptr, nullptr, napi_default,
     nullptr},
    {"isScreenCaptureTrusted", nullptr, IsScreenCaptureTrusted, nullptr,
     nullptr, nullptr, napi_default, nullptr},
    {"requestScreenCaptureAccess", nullptr, RequestScreenCaptureAccess,
     nullptr, nullptr, nullptr, napi_default, nullptr},
    {"list", nullptr, ListApplications, nullptr, nullptr, nullptr, napi_default,
     nullptr},
    {"inspect", nullptr, Inspect, nullptr, nullptr, nullptr, napi_default,
     nullptr},
    {"invoke", nullptr, Invoke, nullptr, nullptr, nullptr, napi_default,
     nullptr},
    {"setValue", nullptr, SetValue, nullptr, nullptr, nullptr, napi_default,
     nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

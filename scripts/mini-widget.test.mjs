import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWidgetExpression,
  normalizeMiniWidget,
} from "../src/lib/mini-widget.ts";

test("mini widget calculator evaluates only bounded declarative math", () => {
  assert.equal(
    evaluateWidgetExpression("bill * (1 + tip / 100)", {
      bill: 80,
      tip: 25,
    }),
    100,
  );
  assert.equal(evaluateWidgetExpression("sqrt(81) + pow(2, 3)", {}), 17);
  assert.equal(evaluateWidgetExpression("2 + 3 * 4 ^ 2", {}), 50);
  assert.throws(() => evaluateWidgetExpression("globalThis.alert(1)", {}));
  assert.throws(() => evaluateWidgetExpression("constructor", {}));
  assert.throws(() => evaluateWidgetExpression("unknown + 1", {}));
  assert.throws(() => evaluateWidgetExpression("1 / 0", {}));
});

test("all supported mini widgets normalize into bounded inert data", () => {
  const widgets = [
    {
      type: "checklist",
      title: "Launch",
      items: ["Plan", { label: "Ship", checked: true }],
    },
    {
      type: "quiz",
      questions: [
        {
          question: "Two plus two?",
          options: ["3", "4"],
          answer: 1,
          explanation: "Two pairs make four.",
        },
      ],
    },
    {
      type: "poll",
      question: "Pick one",
      options: ["Ocean", { label: "Forest", votes: 2 }],
    },
    { type: "counter", value: 4, min: 0, max: 8, step: 1 },
    { type: "timer", durationSeconds: 1_500 },
    {
      type: "flashcards",
      cards: [{ front: "Bonjour", back: "Hello", hint: "Greeting" }],
    },
    {
      type: "calculator",
      fields: [
        { id: "bill", label: "Bill", value: 50, min: 0, max: 500 },
        { id: "tip", label: "Tip", value: 20, min: 0, max: 40 },
      ],
      formula: "bill * (1 + tip / 100)",
      resultLabel: "Total",
    },
  ];
  for (const widget of widgets) {
    const normalized = normalizeMiniWidget(widget);
    assert.ok(normalized, `expected ${widget.type} to normalize`);
    assert.equal(normalized.type, widget.type);
  }
});

test("malformed or unsafe mini widgets remain inert", () => {
  assert.equal(normalizeMiniWidget({ type: "checklist", items: [] }), null);
  assert.equal(
    normalizeMiniWidget({
      type: "quiz",
      questions: [{ question: "Bad", options: ["Only one"], answer: 0 }],
    }),
    null,
  );
  assert.equal(normalizeMiniWidget({ type: "poll", options: ["One"] }), null);
  assert.equal(
    normalizeMiniWidget({
      type: "calculator",
      fields: [{ id: "bad-name", value: 1 }],
      formula: "bad-name",
    }),
    null,
  );
  assert.equal(
    normalizeMiniWidget({
      type: "calculator",
      fields: [{ id: "value", value: 1 }],
      formula: "fetch(value)",
    }),
    null,
  );
});

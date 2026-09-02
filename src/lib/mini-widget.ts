export const MINI_WIDGET_TYPES = [
  "checklist",
  "quiz",
  "poll",
  "counter",
  "timer",
  "flashcards",
  "calculator",
] as const;

export type MiniWidgetType = (typeof MINI_WIDGET_TYPES)[number];

export type MiniWidgetPayload = {
  type: MiniWidgetType;
  title?: string;
  description?: string;
  question?: string;
  items?: Array<string | { label?: string; checked?: boolean }>;
  options?: Array<string | { label?: string; votes?: number }>;
  questions?: Array<{
    question?: string;
    options?: string[];
    answer?: number;
    explanation?: string;
  }>;
  cards?: Array<{ front?: string; back?: string; hint?: string }>;
  durationSeconds?: number;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  fields?: Array<{
    id?: string;
    label?: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
  }>;
  formula?: string;
  resultLabel?: string;
  resultUnit?: string;
  precision?: number;
};

type NormalizedWidgetBase = {
  type: MiniWidgetType;
  title: string;
  description: string;
};

export type NormalizedMiniWidget = NormalizedWidgetBase &
  (
    | {
        type: "checklist";
        items: Array<{ label: string; checked: boolean }>;
      }
    | {
        type: "quiz";
        questions: Array<{
          question: string;
          options: string[];
          answer: number;
          explanation: string;
        }>;
      }
    | {
        type: "poll";
        question: string;
        options: Array<{ label: string; votes: number }>;
      }
    | {
        type: "counter";
        value: number;
        min: number;
        max: number;
        step: number;
      }
    | {
        type: "timer";
        durationSeconds: number;
      }
    | {
        type: "flashcards";
        cards: Array<{ front: string; back: string; hint: string }>;
      }
    | {
        type: "calculator";
        fields: Array<{
          id: string;
          label: string;
          value: number;
          min: number;
          max: number;
          step: number;
          unit: string;
        }>;
        formula: string;
        resultLabel: string;
        resultUnit: string;
        precision: number;
      }
  );

function text(value: unknown, limit = 240) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isMiniWidgetType(value: unknown): value is MiniWidgetType {
  return MINI_WIDGET_TYPES.includes(value as MiniWidgetType);
}

export function normalizeMiniWidget(
  value: unknown,
): NormalizedMiniWidget | null {
  if (!value || typeof value !== "object") return null;
  const input = value as MiniWidgetPayload;
  if (!isMiniWidgetType(input.type)) return null;
  const base = {
    title:
      text(input.title) || input.type[0].toUpperCase() + input.type.slice(1),
    description: text(input.description, 600),
  };

  if (input.type === "checklist") {
    const items = (Array.isArray(input.items) ? input.items : [])
      .slice(0, 24)
      .flatMap((item) => {
        const label = text(typeof item === "string" ? item : item?.label);
        return label
          ? [
              {
                label,
                checked: typeof item === "object" && item?.checked === true,
              },
            ]
          : [];
      });
    return items.length ? { ...base, type: "checklist", items } : null;
  }

  if (input.type === "quiz") {
    const questions = (Array.isArray(input.questions) ? input.questions : [])
      .slice(0, 12)
      .flatMap((entry) => {
        const question = text(entry?.question, 500);
        const options = (Array.isArray(entry?.options) ? entry.options : [])
          .slice(0, 6)
          .map((option) => text(option, 240))
          .filter(Boolean);
        const answer = Math.floor(finite(entry?.answer, -1));
        if (
          !question ||
          options.length < 2 ||
          answer < 0 ||
          answer >= options.length
        )
          return [];
        return [
          {
            question,
            options,
            answer,
            explanation: text(entry?.explanation, 600),
          },
        ];
      });
    return questions.length ? { ...base, type: "quiz", questions } : null;
  }

  if (input.type === "poll") {
    const options = (Array.isArray(input.options) ? input.options : [])
      .slice(0, 10)
      .flatMap((entry) => {
        const label = text(typeof entry === "string" ? entry : entry?.label);
        return label
          ? [
              {
                label,
                votes: clamp(
                  Math.floor(
                    finite(typeof entry === "object" ? entry?.votes : 0, 0),
                  ),
                  0,
                  1_000_000,
                ),
              },
            ]
          : [];
      });
    return options.length >= 2
      ? { ...base, type: "poll", question: text(input.question, 500), options }
      : null;
  }

  if (input.type === "counter") {
    const minimum = finite(input.min, 0);
    const maximum = Math.max(minimum, finite(input.max, 100));
    const step = clamp(Math.abs(finite(input.step, 1)) || 1, 0.0001, 1_000_000);
    return {
      ...base,
      type: "counter",
      min: minimum,
      max: maximum,
      step,
      value: clamp(finite(input.value, minimum), minimum, maximum),
    };
  }

  if (input.type === "timer") {
    return {
      ...base,
      type: "timer",
      durationSeconds: Math.round(
        clamp(finite(input.durationSeconds, 300), 1, 86_400),
      ),
    };
  }

  if (input.type === "flashcards") {
    const cards = (Array.isArray(input.cards) ? input.cards : [])
      .slice(0, 30)
      .flatMap((entry) => {
        const front = text(entry?.front, 800);
        const back = text(entry?.back, 1_200);
        return front && back
          ? [{ front, back, hint: text(entry?.hint, 400) }]
          : [];
      });
    return cards.length ? { ...base, type: "flashcards", cards } : null;
  }

  const seen = new Set<string>();
  const fields = (Array.isArray(input.fields) ? input.fields : [])
    .slice(0, 8)
    .flatMap((entry, index) => {
      const id = text(entry?.id, 40) || `value${index + 1}`;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) || seen.has(id)) return [];
      seen.add(id);
      const minimum = finite(entry?.min, 0);
      const maximum = Math.max(minimum, finite(entry?.max, 100));
      return [
        {
          id,
          label: text(entry?.label) || id,
          value: clamp(finite(entry?.value, minimum), minimum, maximum),
          min: minimum,
          max: maximum,
          step: clamp(Math.abs(finite(entry?.step, 1)) || 1, 0.0001, 1_000_000),
          unit: text(entry?.unit, 24),
        },
      ];
    });
  const formula = text(input.formula, 240);
  if (!fields.length || !formula) return null;
  try {
    evaluateWidgetExpression(
      formula,
      Object.fromEntries(fields.map((field) => [field.id, field.value])),
    );
  } catch {
    return null;
  }
  return {
    ...base,
    type: "calculator",
    fields,
    formula,
    resultLabel: text(input.resultLabel) || "Result",
    resultUnit: text(input.resultUnit, 24),
    precision: Math.round(clamp(finite(input.precision, 2), 0, 6)),
  };
}

type Token = { kind: "number" | "name" | "symbol"; value: string };

function expressionTokens(source: string) {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", value: name[0] });
      index += name[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(source[index])) {
      tokens.push({ kind: "symbol", value: source[index] });
      index += 1;
      continue;
    }
    throw new Error("Unsupported calculator expression");
  }
  if (tokens.length > 120)
    throw new Error("Calculator expression is too complex");
  return tokens;
}

export function evaluateWidgetExpression(
  source: string,
  variables: Record<string, number>,
) {
  const tokens = expressionTokens(source.slice(0, 240));
  let index = 0;
  const peek = (value?: string) =>
    tokens[index] && (value === undefined || tokens[index].value === value)
      ? tokens[index]
      : null;
  const take = (value?: string) => {
    const token = peek(value);
    if (!token) throw new Error("Invalid calculator expression");
    index += 1;
    return token;
  };
  const parsePrimary = (): number => {
    const token = peek();
    if (!token) throw new Error("Incomplete calculator expression");
    if (token.kind === "number") return Number(take().value);
    if (token.value === "(") {
      take("(");
      const result = parseAdditive();
      take(")");
      return result;
    }
    if (token.kind !== "name") throw new Error("Invalid calculator value");
    const name = take().value;
    if (!peek("(")) {
      if (!(name in variables) || !Number.isFinite(variables[name]))
        throw new Error("Unknown calculator field");
      return variables[name];
    }
    take("(");
    const args: number[] = [];
    if (!peek(")")) {
      do {
        args.push(parseAdditive());
        if (!peek(",")) break;
        take(",");
      } while (args.length < 8);
    }
    take(")");
    const functions: Record<string, (...values: number[]) => number> = {
      abs: (value) => Math.abs(value),
      ceil: (value) => Math.ceil(value),
      floor: (value) => Math.floor(value),
      max: (...values) => Math.max(...values),
      min: (...values) => Math.min(...values),
      pow: (left, right) => Math.pow(left, right),
      round: (value) => Math.round(value),
      sqrt: (value) => Math.sqrt(value),
    };
    const operation = functions[name];
    if (!operation || !args.length)
      throw new Error("Unknown calculator function");
    return operation(...args);
  };
  const parseUnary = (): number => {
    if (peek("+")) {
      take("+");
      return parseUnary();
    }
    if (peek("-")) {
      take("-");
      return -parseUnary();
    }
    return parsePrimary();
  };
  const parsePower = (): number => {
    const left = parseUnary();
    if (!peek("^")) return left;
    take("^");
    return Math.pow(left, parsePower());
  };
  const parseMultiplicative = (): number => {
    let result = parsePower();
    while (peek("*") || peek("/") || peek("%")) {
      const operator = take().value;
      const right = parsePower();
      result =
        operator === "*"
          ? result * right
          : operator === "/"
            ? result / right
            : result % right;
    }
    return result;
  };
  const parseAdditive = (): number => {
    let result = parseMultiplicative();
    while (peek("+") || peek("-")) {
      const operator = take().value;
      const right = parseMultiplicative();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  };
  const result = parseAdditive();
  if (
    index !== tokens.length ||
    !Number.isFinite(result) ||
    Math.abs(result) > 1e15
  )
    throw new Error("Calculator result is not finite");
  return result;
}

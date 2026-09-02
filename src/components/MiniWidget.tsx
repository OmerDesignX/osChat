import {
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import { FeatherIcon } from "./FeatherIcon";
import {
  evaluateWidgetExpression,
  normalizeMiniWidget,
  type MiniWidgetPayload,
  type NormalizedMiniWidget,
} from "../lib/mini-widget";

function WidgetButton({
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) {
  return (
    <button type="button" className="mini-widget-button" {...props}>
      {icon && <FeatherIcon icon={icon} size="15" />}
      {children}
    </button>
  );
}

function ChecklistWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "checklist" }>;
}) {
  const initial = widget.items.map((item) => item.checked);
  const [checked, setChecked] = useState(initial);
  const complete = checked.filter(Boolean).length;
  return (
    <div className="mini-widget checklist-widget">
      <div
        className="mini-widget-progress"
        aria-label={`${complete} completed`}
      >
        <span
          style={{
            width: `${(complete / Math.max(1, checked.length)) * 100}%`,
          }}
        />
      </div>
      <p className="mini-widget-summary">
        {complete} of {checked.length} complete
      </p>
      <div className="mini-widget-checklist">
        {widget.items.map((item, index) => {
          const label = item.label;
          return (
            <label
              className={checked[index] ? "complete" : ""}
              key={`${label}-${index}`}
            >
              <input
                type="checkbox"
                checked={checked[index] || false}
                onChange={() =>
                  setChecked((current) =>
                    current.map((value, itemIndex) =>
                      itemIndex === index ? !value : value,
                    ),
                  )
                }
              />
              <span aria-hidden="true">
                <FeatherIcon
                  icon={checked[index] ? "check" : "circle"}
                  size="15"
                />
              </span>
              {label}
            </label>
          );
        })}
      </div>
      <footer>
        <WidgetButton icon="rotate-ccw" onClick={() => setChecked(initial)}>
          Reset
        </WidgetButton>
        <WidgetButton
          icon="check-circle"
          onClick={() => setChecked(checked.map(() => true))}
        >
          Complete all
        </WidgetButton>
      </footer>
    </div>
  );
}

function QuizWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "quiz" }>;
}) {
  const questions = widget.questions;
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Array<number | null>>(
    questions.map(() => null),
  );
  const entry = questions[current];
  if (!entry) return null;
  const selected = answers[current];
  const score = answers.reduce<number>(
    (total, answer, index) =>
      total + (answer === questions[index]?.answer ? 1 : 0),
    0,
  );
  return (
    <div className="mini-widget quiz-widget">
      <div className="mini-widget-kicker">
        <span>
          Question {current + 1} of {questions.length}
        </span>
        <span>{score} correct</span>
      </div>
      <h3>{entry.question}</h3>
      <div className="mini-widget-options">
        {entry.options.map((option, index) => {
          const revealed = selected !== null;
          const state = revealed
            ? index === entry.answer
              ? "correct"
              : index === selected
                ? "incorrect"
                : ""
            : "";
          return (
            <button
              type="button"
              className={state}
              key={`${option}-${index}`}
              disabled={revealed}
              onClick={() =>
                setAnswers((values) =>
                  values.map((value, answerIndex) =>
                    answerIndex === current ? index : value,
                  ),
                )
              }
            >
              <span>{String.fromCharCode(65 + index)}</span>
              {option}
              {state && (
                <FeatherIcon
                  icon={state === "correct" ? "check" : "x"}
                  size="16"
                />
              )}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <p
          className={
            selected === entry.answer ? "quiz-correct" : "quiz-incorrect"
          }
          role="status"
        >
          {selected === entry.answer ? "Correct." : "Not quite."}{" "}
          {entry.explanation}
        </p>
      )}
      <footer>
        <WidgetButton
          icon="chevron-left"
          disabled={current === 0}
          onClick={() => setCurrent((value) => Math.max(0, value - 1))}
        >
          Previous
        </WidgetButton>
        {current < questions.length - 1 ? (
          <WidgetButton
            icon="chevron-right"
            disabled={selected === null}
            onClick={() => setCurrent((value) => value + 1)}
          >
            Next
          </WidgetButton>
        ) : (
          <WidgetButton
            icon="rotate-ccw"
            onClick={() => {
              setAnswers(questions.map(() => null));
              setCurrent(0);
            }}
          >
            Try again
          </WidgetButton>
        )}
      </footer>
    </div>
  );
}

function PollWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "poll" }>;
}) {
  const options = widget.options;
  const initial = options.map((option) => option.votes);
  const [votes, setVotes] = useState(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const total = Math.max(
    1,
    votes.reduce((sum, value) => sum + value, 0),
  );
  const vote = (index: number) => {
    setVotes((current) =>
      current.map((value, itemIndex) =>
        itemIndex === index
          ? value + (selected === index ? 0 : 1)
          : itemIndex === selected
            ? Math.max(0, value - 1)
            : value,
      ),
    );
    setSelected(index);
  };
  return (
    <div className="mini-widget poll-widget">
      {widget.question && <h3>{widget.question}</h3>}
      <div className="poll-options">
        {options.map((option, index) => {
          const label = option.label;
          const percentage = Math.round((votes[index] / total) * 100);
          return (
            <button
              type="button"
              className={selected === index ? "selected" : ""}
              key={`${label}-${index}`}
              onClick={() => vote(index)}
            >
              <span className="poll-fill" style={{ width: `${percentage}%` }} />
              <span>{label}</span>
              <strong>{percentage}%</strong>
            </button>
          );
        })}
      </div>
      <footer>
        <span>
          {selected === null
            ? "Choose an option"
            : "Your choice is highlighted"}
        </span>
        <WidgetButton
          icon="rotate-ccw"
          onClick={() => {
            setVotes(initial);
            setSelected(null);
          }}
        >
          Reset
        </WidgetButton>
      </footer>
    </div>
  );
}

function CounterWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "counter" }>;
}) {
  const initial = widget.value;
  const minimum = widget.min;
  const maximum = widget.max;
  const step = widget.step;
  const [value, setValue] = useState(initial);
  const update = (next: number) =>
    setValue(Math.min(maximum, Math.max(minimum, next)));
  return (
    <div className="mini-widget counter-widget">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => update(value - step)}
      >
        <FeatherIcon icon="minus" size="22" />
      </button>
      <output aria-live="polite">{Number(value.toFixed(4))}</output>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => update(value + step)}
      >
        <FeatherIcon icon="plus" size="22" />
      </button>
      <WidgetButton icon="rotate-ccw" onClick={() => setValue(initial)}>
        Reset
      </WidgetButton>
    </div>
  );
}

function clockTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .filter((_value, index) => hours > 0 || index > 0)
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function TimerWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "timer" }>;
}) {
  const duration = widget.durationSeconds;
  const [remaining, setRemaining] = useState(duration);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  const progress = Math.max(0, Math.min(1, remaining / duration));
  return (
    <div className="mini-widget timer-widget">
      <div
        className="timer-dial"
        style={{ "--timer-progress": `${progress * 360}deg` } as CSSProperties}
      >
        <output aria-live="polite">{clockTime(remaining)}</output>
        <small>
          {remaining === 0 ? "Complete" : running ? "In progress" : "Ready"}
        </small>
      </div>
      <footer>
        <WidgetButton
          icon={running ? "pause" : "play"}
          disabled={remaining === 0}
          onClick={() => setRunning((value) => !value)}
        >
          {running ? "Pause" : "Start"}
        </WidgetButton>
        <WidgetButton
          icon="rotate-ccw"
          onClick={() => {
            setRunning(false);
            setRemaining(duration);
          }}
        >
          Reset
        </WidgetButton>
      </footer>
    </div>
  );
}

function FlashcardWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "flashcards" }>;
}) {
  const cards = widget.cards;
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[current];
  if (!card) return null;
  const move = (next: number) => {
    setCurrent((next + cards.length) % cards.length);
    setFlipped(false);
  };
  return (
    <div className="mini-widget flashcard-widget">
      <div className="mini-widget-kicker">
        Card {current + 1} of {cards.length}
      </div>
      <button
        type="button"
        className={`flashcard ${flipped ? "flipped" : ""}`}
        aria-label={flipped ? "Show question" : "Reveal answer"}
        onClick={() => setFlipped((value) => !value)}
      >
        <small>{flipped ? "Answer" : "Question"}</small>
        <strong>{flipped ? card.back : card.front}</strong>
        {!flipped && card.hint && <span>Hint: {card.hint}</span>}
        <em>{flipped ? "Click to show front" : "Click to reveal"}</em>
      </button>
      <footer>
        <WidgetButton icon="chevron-left" onClick={() => move(current - 1)}>
          Previous
        </WidgetButton>
        <WidgetButton
          icon="refresh-cw"
          onClick={() => setFlipped((value) => !value)}
        >
          Flip
        </WidgetButton>
        <WidgetButton icon="chevron-right" onClick={() => move(current + 1)}>
          Next
        </WidgetButton>
      </footer>
    </div>
  );
}

function CalculatorWidget({
  widget,
}: {
  widget: Extract<NormalizedMiniWidget, { type: "calculator" }>;
}) {
  const fields = widget.fields;
  const initial = Object.fromEntries(
    fields.map((field) => [field.id, field.value]),
  );
  const [values, setValues] = useState<Record<string, number>>(initial);
  const result = useMemo(() => {
    try {
      return evaluateWidgetExpression(widget.formula, values);
    } catch {
      return null;
    }
  }, [values, widget.formula]);
  const update = (
    id: string,
    next: number,
    minimum: number,
    maximum: number,
  ) => {
    if (!Number.isFinite(next)) return;
    setValues((current) => ({
      ...current,
      [id]: Math.min(maximum, Math.max(minimum, next)),
    }));
  };
  return (
    <div className="mini-widget calculator-widget">
      <div className="calculator-fields">
        {fields.map((field) => {
          const id = field.id;
          const minimum = field.min;
          const maximum = field.max;
          return (
            <label key={id}>
              <span>
                {field.label}
                {field.unit && <small>{field.unit}</small>}
              </span>
              <input
                type="number"
                min={minimum}
                max={maximum}
                step={field.step}
                value={values[id]}
                onChange={(event) =>
                  update(
                    id,
                    event.currentTarget.valueAsNumber,
                    minimum,
                    maximum,
                  )
                }
              />
              <input
                type="range"
                min={minimum}
                max={maximum}
                step={field.step}
                value={values[id]}
                aria-label={`${field.label} slider`}
                onChange={(event) =>
                  update(
                    id,
                    event.currentTarget.valueAsNumber,
                    minimum,
                    maximum,
                  )
                }
              />
            </label>
          );
        })}
      </div>
      <output className="calculator-result" aria-live="polite">
        <small>{widget.resultLabel}</small>
        <strong>
          {result === null
            ? "—"
            : Number(result.toFixed(widget.precision)).toLocaleString()}
          {widget.resultUnit && <span>{widget.resultUnit}</span>}
        </strong>
      </output>
      <footer>
        <WidgetButton icon="rotate-ccw" onClick={() => setValues(initial)}>
          Reset values
        </WidgetButton>
      </footer>
    </div>
  );
}

export function MiniWidget({ payload }: { payload: MiniWidgetPayload }) {
  const widget = useMemo(() => normalizeMiniWidget(payload), [payload]);
  if (!widget) return null;
  if (widget.type === "checklist") return <ChecklistWidget widget={widget} />;
  if (widget.type === "quiz") return <QuizWidget widget={widget} />;
  if (widget.type === "poll") return <PollWidget widget={widget} />;
  if (widget.type === "counter") return <CounterWidget widget={widget} />;
  if (widget.type === "timer") return <TimerWidget widget={widget} />;
  if (widget.type === "flashcards") return <FlashcardWidget widget={widget} />;
  return <CalculatorWidget widget={widget} />;
}

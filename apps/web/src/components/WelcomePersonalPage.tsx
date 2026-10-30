import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useCommunityAgentName } from "../../../../shared/CommunityAgentIcon";
import { formQuestionAnswered, type FormAnswers } from "../../../../shared/communityFormAnswers";
import type { WelcomePersonalQuestions } from "../../../../shared/cloudCommunityWelcomePersonalGateway";
import { MemberFormQuestionInput } from "./WebCommunityNextStep";

type Props = {
  /** Writes the questions on the first visit (the agent, or the owner's backup) and returns the same ones after. */
  load: () => Promise<WelcomePersonalQuestions>;
  /** Saves the answers; done once the member presses Next. */
  save: (answers: FormAnswers, done: boolean) => Promise<void>;
  onDone: () => void;
  nextLabel?: string;
  /** The owner's preview: says so under the button. */
  preview?: boolean;
};

// Questions the community's agent wrote for this member from the owner's goal
// and their earlier answers. They show like the owner's own questions, with a
// line saying who wrote them.
export function WelcomePersonalPage(props: Props) {
  const id = useId();
  const agent = useCommunityAgentName(null) || "Your guide";
  const [set, setSet] = useState<WelcomePersonalQuestions | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const latest = useRef(answers); latest.current = answers;
  const saved = useRef("{}");

  const load = async () => {
    setError(null);
    try {
      const next = await props.load();
      if (!alive.current) return;
      // Answered before (another device, a cleared browser): the page moves on by itself.
      if (next.answered && !props.preview) { props.onDone(); return; }
      setSet(next); setAnswers(next.answers); saved.current = JSON.stringify(next.answers);
    } catch { if (alive.current) setError("These questions could not be opened. Check your connection and try again."); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  // Answers save as the member types, so leaving and coming back keeps them.
  useEffect(() => {
    if (!set || busy || JSON.stringify(answers) === saved.current) return;
    const timer = setTimeout(() => {
      const snapshot = latest.current;
      void props.save(snapshot, false).then(() => { saved.current = JSON.stringify(snapshot); }).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [answers, set, busy]);

  const goOn = async () => {
    if (!set) return;
    const found = Object.fromEntries(set.questions.filter((q) => q.required && !formQuestionAnswered(q, answers)).map((q) => [q.key, "Please answer this question."]));
    setIssues(found);
    if (Object.keys(found).length) return;
    setBusy(true); setError(null);
    try { await props.save(answers, true); saved.current = JSON.stringify(answers); props.onDone(); }
    catch { if (alive.current) setError("Could not save. Your answers are still here. Try again."); }
    finally { if (alive.current) setBusy(false); }
  };

  if (!set) return <div className="welcome-form-page welcome-personal-page" aria-busy={!error}>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="platform-save-button" onClick={() => void load()}>Retry</button></div>
      : <p role="status" className="welcome-personal-writing"><Sparkles size={16} aria-hidden="true" /> {agent} is writing a few questions for you…</p>}
  </div>;
  return <div className="welcome-form-page welcome-personal-page" data-personal="true">
    {set.source === "agent" ? <p className="welcome-personal-by"><Sparkles size={14} aria-hidden="true" /> Written for you by {agent}, from your answers</p> : null}
    {set.questions.map((q) => {
      const fieldId = `${id}-${q.key}`;
      const field = { "aria-labelledby": `${fieldId}-title`, "aria-describedby": [q.description ? `${fieldId}-help` : "", issues[q.key] ? `${fieldId}-issue` : ""].filter(Boolean).join(" ") || undefined,
        "aria-invalid": issues[q.key] ? true : undefined };
      return <div key={q.key} className="welcome-form-question" data-question={q.key}
        onChange={() => setIssues((all) => { const { [q.key]: _gone, ...rest } = all; return rest; })}>
        <h2 id={`${fieldId}-title`}>{q.title}{q.required ? null : <small> Optional</small>}</h2>
        {q.description ? <p id={`${fieldId}-help`}>{q.description}</p> : null}
        <MemberFormQuestionInput question={q} answers={answers} setAnswers={setAnswers} disabled={busy} field={field} />
        {issues[q.key] ? <p role="alert" id={`${fieldId}-issue`} className="member-form-issue">{issues[q.key]}</p> : null}
      </div>;
    })}
    {error ? <p role="alert" className="member-form-issue">{error}</p> : null}
    <footer className="community-welcome-next">
      <button type="button" className="platform-save-button" disabled={busy} onClick={() => void goOn()}>{busy ? "Saving…" : props.nextLabel ?? "Next"}</button>
      {props.preview ? <small role="status">Preview: answers aren't saved</small> : null}
    </footer>
  </div>;
}

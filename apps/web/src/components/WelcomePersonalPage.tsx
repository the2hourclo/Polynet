import { useEffect, useId, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useCommunityAgentName } from "../../../../shared/CommunityAgentIcon";
import { formQuestionAnswered, type FormAnswers } from "../../../../shared/communityFormAnswers";
import type { WelcomePersonalQuestions } from "../../../../shared/cloudCommunityWelcomePersonalGateway";
import { MemberFormQuestionInput } from "./WebCommunityNextStep";

type Props = {
  /** The question waiting for the member; after an answer is sent, the agent's next one, or answered once it's done. */
  load: () => Promise<WelcomePersonalQuestions>;
  /** Saves the answer; done sends it in, so the next load moves on. */
  save: (answers: FormAnswers, done: boolean) => Promise<void>;
  onDone: () => void;
  /** The owner's preview: says so under the button. */
  preview?: boolean;
};

// Questions the community's agent asks one at a time, from the owner's goal and
// everything the member has said. After each answer it asks again or finishes,
// so the page has as many questions as the goal needs. A line says who wrote them.
export function WelcomePersonalPage(props: Props) {
  const id = useId();
  const agent = useCommunityAgentName(null) || "Your guide";
  const [set, setSet] = useState<WelcomePersonalQuestions | null>(null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const latest = useRef(answers); latest.current = answers;
  const saved = useRef("{}");
  const question = set ? set.questions[set.questions.length - 1] : undefined;

  // One ask at a time: React's dev double-mount (and a fast double tap) would otherwise ask the agent twice.
  const inflight = useRef<Promise<WelcomePersonalQuestions> | null>(null);
  const load = async () => {
    setError(null); setSet(null);
    try {
      const pending = inflight.current ??= props.load().finally(() => { inflight.current = null; });
      const next = await pending;
      if (!alive.current) return;
      if (next.answered) { props.onDone(); return; }
      setSet(next); setAnswers(next.answers); saved.current = JSON.stringify(next.answers); setIssue(null);
    } catch { if (alive.current) setError("These questions could not be opened. Check your connection and try again."); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  // The answer saves as the member types, so leaving and coming back keeps it.
  useEffect(() => {
    if (!set || busy || props.preview || JSON.stringify(answers) === saved.current) return;
    const timer = setTimeout(() => {
      const snapshot = latest.current;
      void props.save(snapshot, false).then(() => { saved.current = JSON.stringify(snapshot); }).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [answers, set, busy]);

  const goOn = async () => {
    if (!question) return;
    if (!formQuestionAnswered(question, answers)) { setIssue("Please answer this question."); return; }
    setBusy(true); setError(null);
    try { await props.save(answers, true); saved.current = JSON.stringify(answers); }
    catch { if (alive.current) setError("Could not save. Your answer is still here. Try again."); setBusy(false); return; }
    setBusy(false);
    if (alive.current) await load();
  };

  if (!set || !question) return <div className="welcome-form-page welcome-personal-page" aria-busy={!error}>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="platform-save-button" onClick={() => void load()}>Retry</button></div>
      : <p role="status" className="welcome-personal-writing"><Sparkles size={16} aria-hidden="true" /> {agent} is {set ? "thinking" : "writing a question for you"}…</p>}
  </div>;
  const fieldId = `${id}-${question.key}`;
  const field = { "aria-labelledby": `${fieldId}-title`, "aria-describedby": [question.description ? `${fieldId}-help` : "", issue ? `${fieldId}-issue` : ""].filter(Boolean).join(" ") || undefined,
    "aria-invalid": issue ? true : undefined };
  return <div className="welcome-form-page welcome-personal-page" data-personal="true">
    {set.source === "agent" ? <p className="welcome-personal-by"><Sparkles size={14} aria-hidden="true" /> {agent} asks, from your answers</p> : null}
    <div key={question.key} className="welcome-form-question" data-question={question.key} onChange={() => setIssue(null)}>
      <h2 id={`${fieldId}-title`}>{question.title}</h2>
      {question.description ? <p id={`${fieldId}-help`}>{question.description}</p> : null}
      <MemberFormQuestionInput question={question} answers={answers} setAnswers={setAnswers} disabled={busy} field={field} />
      {issue ? <p role="alert" id={`${fieldId}-issue`} className="member-form-issue">{issue}</p> : null}
    </div>
    {error ? <p role="alert" className="member-form-issue">{error}</p> : null}
    <footer className="community-welcome-next">
      <button type="button" className="platform-save-button" disabled={busy} onClick={() => void goOn()}>{busy ? "Saving…" : "Next"}</button>
      {props.preview ? <small role="status">Preview: answers aren't saved</small> : null}
    </footer>
  </div>;
}

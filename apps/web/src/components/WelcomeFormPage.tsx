import { useEffect, useId, useRef, useState } from "react";
import type { AuthSession } from "../auth";
import { getMemberForm, saveMemberForm, type MemberFormRequest } from "../../../../shared/cloudCommunityFormRequestsGateway";
import { formAnswersIssue, formQuestionAnswered, type FormAnswers } from "../../../../shared/communityFormAnswers";
import { communityClientAnswerFormatIssue } from "../../../../shared/communityClients";
import type { CommunityFormQuestion } from "../../../../shared/communityForms";
import { FORMAT_HINTS, MemberFormQuestionInput } from "./WebCommunityNextStep";
import { createMemberFormSave } from "./memberFormSave";

type Props = {
  communityId: string; requestId: string;
  session?: AuthSession; ensureSession?: (session: AuthSession, source?: string) => Promise<AuthSession | null>;
  /** The questions this page shows, picked from the member's copy of the form. */
  pick: (questions: CommunityFormQuestion[]) => CommunityFormQuestion[];
  /** The form's last page: its button sends the form in. */
  last: boolean;
  /** The page is done: its answers are saved (and, on the last page, the form is sent in). */
  onPageDone: () => void;
  /** The owner's preview: the form as members get it; nothing is loaded or saved. */
  preview?: MemberFormRequest;
  /** The button's words on the last page. */
  submitLabel?: string;
};

// One page of a form split across the welcome page (Tally style): every
// question on the page shows at once, the answers save as the member types,
// and the form is sent in on its last page.
export function WelcomeFormPage(props: Props) {
  const id = useId();
  const [request, setRequest] = useState<MemberFormRequest | null>(props.preview ?? null);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const saver = useRef<ReturnType<typeof createMemberFormSave> | null>(null);
  const latest = useRef(answers); latest.current = answers;
  const alive = useRef(true);
  const autoDone = useRef(false);
  const questions = request ? props.pick(request.questions) : [];

  const load = async () => {
    if (props.preview || !props.session || !props.ensureSession) return;
    setError(null);
    try {
      const ready = await props.ensureSession(props.session, "member_form");
      if (!ready) throw new Error("session_unavailable");
      const row = await getMemberForm(ready, props.communityId, props.requestId);
      if (!alive.current) return;
      saver.current = createMemberFormSave(row, async (attempt) => {
        const again = await props.ensureSession!(props.session!, "member_form");
        if (!again) throw new Error("session_unavailable");
        return saveMemberForm(again, props.communityId, { ...row, revision: attempt.revision }, attempt.answers, attempt.intent === "submit");
      });
      setRequest(row); setAnswers(row.answers);
    } catch { if (alive.current) setError("This page could not be opened. Check your connection and try again."); }
  };
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [props.requestId]);
  // An earlier page whose answers were all saved before (another device, a cleared browser) moves on by itself.
  useEffect(() => {
    if (!request || props.preview || props.last || autoDone.current) return;
    const mine = props.pick(request.questions);
    if (mine.length === 0 || mine.every((q) => formQuestionAnswered(q, request.answers))) { autoDone.current = true; props.onPageDone(); }
  }, [request]);

  const save = async (intent: "autosave" | "continue" | "submit") => {
    if (!request) return false;
    if (props.preview) return true;
    if (!saver.current) return false;
    setBusy(intent !== "autosave");
    try {
      const result = await saver.current.run(intent, latest.current);
      return Boolean(result);
    } catch {
      if (intent !== "autosave") setError("Could not save. Your answers are still here. Try again.");
      return false;
    } finally { if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    if (!request || props.preview || busy || !saver.current?.dirty(answers)) return;
    const timer = setTimeout(() => { void save("autosave"); }, 700);
    return () => clearTimeout(timer);
  }, [answers, request, busy]);

  const goOn = async () => {
    const found: Record<string, string> = {};
    for (const q of questions) {
      if (q.required && !formQuestionAnswered(q, answers)) found[q.key] = "Please answer this question.";
      else if (q.answerFormat && typeof answers[q.key] === "string" && answers[q.key]) {
        const shape = communityClientAnswerFormatIssue(q.answerFormat, answers[q.key] as string);
        if (shape) found[q.key] = shape;
      }
    }
    setIssues(found);
    const first = questions.find((q) => found[q.key]);
    if (first) { document.getElementById(`${id}-${first.key}-title`)?.closest("fieldset, .welcome-form-question")?.querySelector<HTMLElement>("input, textarea")?.focus(); return; }
    if (props.last && request) {
      // Anything still missing sits on an earlier page; say so rather than fail quietly.
      const missing = formAnswersIssue(request.questions, answers, true);
      if (missing && !props.preview) { setError(missing); return; }
    }
    if (await save(props.last ? "submit" : "continue")) props.onPageDone();
  };

  if (!request) return error
    ? <div role="alert" className="welcome-form-page"><p>{error}</p><button type="button" onClick={() => void load()}>Retry</button></div>
    : <p role="status">Loading…</p>;
  return <div className="welcome-form-page" data-form={request.name}>
    {questions.map((q) => {
      const fieldId = `${id}-${q.key}`;
      const field = {
        "aria-labelledby": `${fieldId}-title`,
        "aria-describedby": [q.description ? `${fieldId}-help` : "", q.answerFormat ? `${fieldId}-format` : "", issues[q.key] ? `${fieldId}-issue` : ""].filter(Boolean).join(" ") || undefined,
        "aria-invalid": issues[q.key] ? true : undefined,
      };
      return <div key={q.key} className="welcome-form-question" data-question={q.key} onChange={() => setIssues((all) => { const { [q.key]: _gone, ...rest } = all; return rest; })}>
        <h2 id={`${fieldId}-title`}>{q.title}{q.required ? null : <small> Optional</small>}</h2>
        {q.description ? <p id={`${fieldId}-help`}>{q.description}</p> : null}
        {q.answerFormat ? <p id={`${fieldId}-format`} className="member-form-format">{FORMAT_HINTS[q.answerFormat]}</p> : null}
        <MemberFormQuestionInput question={q} answers={answers} setAnswers={setAnswers} disabled={busy} field={field} />
        {issues[q.key] ? <p role="alert" id={`${fieldId}-issue`} className="member-form-issue">{issues[q.key]}</p> : null}
      </div>;
    })}
    {error ? <p role="alert" className="member-form-issue">{error}</p> : null}
    <footer className="community-welcome-next">
      <button type="button" className="platform-save-button" disabled={busy} onClick={() => void goOn()}>
        {busy ? "Saving…" : props.last ? props.submitLabel ?? "Submit" : "Next"}
      </button>
      <small role="status">{props.preview ? "Preview: answers aren't saved" : saver.current?.dirty(answers) ? "Saving as you type" : "Saved"}</small>
    </footer>
  </div>;
}

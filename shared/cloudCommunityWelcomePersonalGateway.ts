import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityFormQuestion } from "./communityForms";
import type { FormAnswers } from "./communityFormAnswers";
import type { WelcomePersonalAnswer } from "./communityWelcomePersonal";

export type WelcomePersonalQuestions = { questions: CommunityFormQuestion[]; answers: FormAnswers; source: "agent" | "backup"; answered: boolean };

/** The member's personal page: the question waiting for them; after an answer, the agent's next one (or answered: true). */
export async function askMyWelcomePersonalQuestions(session: unknown, communityId: string, blockKey: string): Promise<WelcomePersonalQuestions> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.action(api.communityWelcomePersonal.askMyWelcomePersonalQuestions, { authSubject, communityId: communityId as Id<"communities">, blockKey });
}
export async function saveMyWelcomePersonalAnswers(session: unknown, communityId: string, blockKey: string, answers: FormAnswers, done: boolean) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.mutation(api.communityWelcomePersonal.saveMyWelcomePersonalAnswers, { authSubject, communityId: communityId as Id<"communities">, blockKey, answers, done });
}
/** The owner's preview: the agent's next move for a pretend member. replied with no question means it finishes. */
export async function previewWelcomePersonalQuestions(session: unknown, communityId: string,
  draft: { goal: string; count: number; persona: string; asked: number; answers: WelcomePersonalAnswer[]; askedHere?: WelcomePersonalAnswer[] }): Promise<{ question: CommunityFormQuestion | null; replied: boolean }> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.action(api.communityWelcomePersonal.previewWelcomePersonalQuestions, { authSubject, communityId: communityId as Id<"communities">, ...draft });
}
export async function listMemberWelcomePersonalAnswers(session: unknown, communityId: string, membershipId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.query(api.communityWelcomePersonal.listBuilderMemberPersonalAnswers, { authSubject, communityId: communityId as Id<"communities">, membershipId: membershipId as Id<"communityMemberships"> });
}

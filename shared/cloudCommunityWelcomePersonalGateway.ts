import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { bootstrapConvexAuthenticatedClient } from "./convexAuthenticatedClient";
import type { CommunityFormQuestion } from "./communityForms";
import type { FormAnswers } from "./communityFormAnswers";
import type { WelcomePersonalAnswer } from "./communityWelcomePersonal";

export type WelcomePersonalQuestions = { questions: CommunityFormQuestion[]; answers: FormAnswers; source: "agent" | "backup"; answered: boolean };

/** The member's personal questions for one welcome block; the first call has the agent write them. */
export async function askMyWelcomePersonalQuestions(session: unknown, communityId: string, blockKey: string): Promise<WelcomePersonalQuestions> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.action(api.communityWelcomePersonal.askMyWelcomePersonalQuestions, { authSubject, communityId: communityId as Id<"communities">, blockKey });
}
export async function saveMyWelcomePersonalAnswers(session: unknown, communityId: string, blockKey: string, answers: FormAnswers, done: boolean) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.mutation(api.communityWelcomePersonal.saveMyWelcomePersonalAnswers, { authSubject, communityId: communityId as Id<"communities">, blockKey, answers, done });
}
/** The owner's preview for a pretend member; null questions means the backup would be asked. */
export async function previewWelcomePersonalQuestions(session: unknown, communityId: string,
  draft: { goal: string; count: number; persona: string; answers: WelcomePersonalAnswer[] }): Promise<{ questions: CommunityFormQuestion[] | null }> {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.action(api.communityWelcomePersonal.previewWelcomePersonalQuestions, { authSubject, communityId: communityId as Id<"communities">, ...draft });
}
export async function listMemberWelcomePersonalAnswers(session: unknown, communityId: string, membershipId: string) {
  const { client, authSubject } = await bootstrapConvexAuthenticatedClient(session);
  return client.query(api.communityWelcomePersonal.listBuilderMemberPersonalAnswers, { authSubject, communityId: communityId as Id<"communities">, membershipId: membershipId as Id<"communityMemberships"> });
}

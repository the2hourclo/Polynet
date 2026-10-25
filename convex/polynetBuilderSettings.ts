// Every setting an owner can change in Polynet's Settings can also be changed
// by the owner's own agent (Rashid, 2026-10-25). Each operation below is a
// polynet_call capability for the external MCP, and it runs the same public
// mutation the Settings page runs, as the signed-in owner. Validation, revisions,
// audit and side effects therefore stay in one place, the page's own backend.
//
// The agent reads the current values from /builder/settings.json, then calls
// with snake_case names for the mutation's fields (expected_revision ->
// expectedRevision). communityId always comes from the mounted community, and
// identity always comes from the sign-in, never from input.
//
// SETTINGS_UI_WRITES is the parity list that scripts/settings_agent_parity.test.ts
// holds the web app to: every write the app makes is either an operation here or
// has a stated reason not to be one.
import { api, internal } from "./_generated/api";
import { buildAgentLedJourneyPlan } from "../shared/agentLedJourneyTemplate";

export type BuilderSettingOperation = {
  operation: string;
  // Which Settings page it belongs to.
  area: "general" | "pricing" | "sales_page" | "welcome" | "workflows" | "forms" | "access" | "agent" | "channels" | "members";
  name: string;
  // The public function the Settings page calls ("module:function").
  calls: string;
  ref: any;
  kind: "mutation" | "action";
  // snake_case input -> what it is. Anything else is refused.
  fields: Record<string, string>;
  required: string[];
  // Filled from the current settings when the agent leaves them out.
  merge?: "community_settings";
  // "auth" (default) signs in as the caller, like the page. "user" is for an
  // internal twin that takes the resolved userId (so the history can say "agent").
  identity?: "auth" | "user";
  // Fixed arguments added to every call.
  extra?: Record<string, unknown>;
  // false when the function isn't scoped to one community.
  community?: false;
  // "owner_apply": hard to undo, so the agent only proposes it. It runs when
  // the owner taps Apply in the app (convex/communitySettingProposals.ts).
  review?: "owner_apply";
  effects: string[];
};

const op = (spec: BuilderSettingOperation) => spec;

export const BUILDER_SETTING_OPERATIONS: BuilderSettingOperation[] = [
  op({
    operation: "community.settings.save", area: "general", name: "Identity and public profile",
    calls: "communityLifecycle:saveCommunitySettings", ref: api.communityLifecycle.saveCommunitySettings, kind: "mutation",
    fields: {
      expected_settings_revision: "settings_revision from /builder/settings.json; refused if someone saved since",
      name: "community name", slug: "web address (lowercase letters, digits, dashes)",
      one_liner: "one line under the name, or null", about: "the About text (Markdown), or null",
      avatar_storage_id: "logo from community.settings.upload_url, or null to remove", avatar_url: "logo as an https image URL",
      avatar_focus_x: "0-100", avatar_focus_y: "0-100", avatar_zoom: "1-3",
      banner_storage_id: "banner from community.settings.upload_url, or null to remove", banner_url: "banner as an https image URL",
      banner_focus_x: "0-100", banner_focus_y: "0-100", banner_zoom: "1-3",
      visibility: "published (listed in Discover) or unlisted",
    },
    required: ["expected_settings_revision"], merge: "community_settings",
    effects: ["update_community_identity"],
  }),
  op({
    operation: "community.settings.upload_url", area: "general", name: "Upload a logo or banner",
    calls: "communityLifecycle:generateCommunityBrandingUploadUrl", ref: api.communityLifecycle.generateCommunityBrandingUploadUrl, kind: "mutation",
    fields: { kind: "avatar (the logo) or banner" }, required: ["kind"], community: false,
    effects: ["issue_upload_url"],
  }),
  op({
    operation: "community.sales_page.external_url.set", area: "sales_page", name: "Use your own sales page",
    calls: "communityFunnel:setCommunityExternalFunnelUrl", ref: api.communityFunnel.setCommunityExternalFunnelUrl, kind: "mutation",
    fields: { expected_settings_revision: "settings_revision from /builder/settings.json", url: "https URL of your own sales page, or null" },
    required: ["expected_settings_revision", "url"], effects: ["set_external_sales_page"],
  }),
  op({
    operation: "community.sales_page.external_url.activate", area: "sales_page", name: "Send visitors to your own sales page",
    calls: "communityFunnel:setCommunityExternalFunnelActive", ref: api.communityFunnel.setCommunityExternalFunnelActive, kind: "mutation",
    fields: { expected_settings_revision: "settings_revision from /builder/settings.json", expected_url: "the URL you set", active: "true or false" },
    required: ["expected_settings_revision", "expected_url", "active"], effects: ["switch_sales_page"],
  }),
  op({
    operation: "community.sales_page.video.set", area: "sales_page", name: "Sales page video",
    calls: "communityFunnel:setCommunityFunnelDraftVsl", ref: api.communityFunnel.setCommunityFunnelDraftVsl, kind: "mutation",
    fields: { expected_draft_revision: "the funnel draft_revision from /builder/settings.json", url: "video URL, or null", slot: "optional funnel slot" },
    required: ["expected_draft_revision", "url"], effects: ["set_sales_page_video_draft"],
  }),
  op({
    operation: "community.sales_page.about.save", area: "sales_page", name: "Sales page About text",
    calls: "communityLifecycle:saveCommunityAbout", ref: api.communityLifecycle.saveCommunityAbout, kind: "mutation",
    fields: { about: "the About text (Markdown), or null" }, required: ["about"], effects: ["update_about"],
  }),
  op({
    operation: "community.sales_page.publish", area: "sales_page", name: "Publish the sales page draft",
    calls: "communityFunnel:publishCommunityFunnelDraft", ref: api.communityFunnel.publishCommunityFunnelDraft, kind: "mutation",
    fields: { expected_draft_revision: "the draft_revision you checked", slot: "optional funnel slot" },
    required: ["expected_draft_revision"], effects: ["publish_sales_page"],
  }),
  op({
    operation: "community.sales_page.activate", area: "sales_page", name: "Choose which sales page visitors see",
    calls: "communityFunnel:setActiveCommunityFunnel", ref: api.communityFunnel.setActiveCommunityFunnel, kind: "mutation",
    fields: { target: '{ "slot": "default" }, or { "slot": "<custom slot>", "expectedPublishedDraftRevision": <n> }' },
    required: ["target"], effects: ["switch_sales_page"],
  }),
  op({
    operation: "community.welcome.save", area: "welcome", name: "Welcome page",
    calls: "communityMemberWorkflows:saveBuilderWelcomePage", ref: api.communityMemberWorkflows.saveBuilderWelcomePage, kind: "mutation",
    fields: { expected_revision: "workflow revision from /builder/settings.json", title: "heading", message: "welcome text (Markdown)",
      media_url: "video or image URL, or empty", lesson_ids: "lesson resource ids new members start with" },
    required: ["expected_revision", "title", "message", "media_url", "lesson_ids"], effects: ["update_welcome_page"],
  }),
  op({
    operation: "community.welcome.gate.set", area: "welcome", name: "Welcome page first",
    calls: "communityMemberWorkflows:setBuilderWelcomeGate", ref: api.communityMemberWorkflows.setBuilderWelcomeGate, kind: "mutation",
    fields: { expected_revision: "workflow revision", enabled: "true: new members see the welcome page before anything else" },
    required: ["expected_revision", "enabled"], effects: ["set_welcome_gate"],
  }),
  op({
    operation: "community.workflow.stage.create", area: "workflows", name: "Add a workflow stage",
    calls: "communityMemberWorkflows:createBuilderWorkflowMilestone", ref: api.communityMemberWorkflows.createBuilderWorkflowMilestone, kind: "mutation",
    fields: { expected_revision: "workflow revision", name: "stage name", goal: "what finishing it means", instructions: "notes for the agent",
      require_human_approval: "true: you approve each member moving on" },
    required: ["expected_revision", "name"], effects: ["add_workflow_stage"],
  }),
  op({
    operation: "community.workflow.stage.update", area: "workflows", name: "Change a workflow stage",
    calls: "communityMemberWorkflows:updateBuilderWorkflowMilestone", ref: api.communityMemberWorkflows.updateBuilderWorkflowMilestone, kind: "mutation",
    fields: { expected_revision: "workflow revision", milestone_key: "the stage's key", name: "stage name", goal: "what finishing it means",
      instructions: "notes for the agent", require_human_approval: "true or false",
      automations: "the stage's full list of automations, as /builder/settings.json shows them" },
    required: ["expected_revision", "milestone_key", "name", "automations"], effects: ["update_workflow_stage"],
  }),
  op({
    operation: "community.form.save", area: "forms", name: "Create or edit a form",
    calls: "communityForms:saveBuilderForm", ref: api.communityForms.saveBuilderForm, kind: "mutation",
    fields: { key: "the form's key (a new key makes a new form)", expected_revision: "the form's revision, 0 for a new one",
      name: "form name", questions: "the full list of questions, as /builder/settings.json shows them" },
    required: ["key", "expected_revision", "name", "questions"], effects: ["save_form_draft"],
  }),
  op({
    operation: "community.form.publish", area: "forms", name: "Publish a form",
    calls: "communityForms:publishBuilderForm", ref: api.communityForms.publishBuilderForm, kind: "mutation",
    fields: { key: "the form's key", expected_revision: "the revision you checked" },
    required: ["key", "expected_revision"], effects: ["publish_form_version"],
  }),
  op({
    operation: "community.access.grant", area: "access", name: "Give access, or change a grant's end date",
    calls: "communityAccess:grantCommunityAccess", ref: internal.communityAccess.grantCommunityAccessInternal, kind: "mutation",
    identity: "user", extra: { via: "agent" },
    fields: { membership_id: "an existing member, or", email: "someone to invite by email", reason: "why (shown in the history)",
      ends_at: "ISO date or instant, or null for no end date" },
    required: ["reason"], effects: ["grant_owner_access"],
  }),
  op({
    operation: "community.access.integration.update", area: "access", name: "Change a connected service",
    calls: "communityAccess:updateAccessIntegration", ref: api.communityAccess.updateAccessIntegration, kind: "mutation",
    fields: { integration_id: "from /builder/settings.json", name: "name", webhook_url: "https webhook", price_point_ids: "which plans count",
      include_owner_grants: "true: access you give by hand counts too" },
    required: ["integration_id"], effects: ["update_access_integration"],
  }),
  op({
    operation: "community.access.integration.test", area: "access", name: "Send a test event",
    calls: "communityAccess:sendAccessIntegrationTest", ref: api.communityAccess.sendAccessIntegrationTest, kind: "mutation",
    fields: { integration_id: "from /builder/settings.json" }, required: ["integration_id"], effects: ["send_test_webhook"],
  }),
  op({
    operation: "community.access.integration.retry", area: "access", name: "Retry a failed event",
    calls: "communityAccess:retryAccessIntegrationEvent", ref: api.communityAccess.retryAccessIntegrationEvent, kind: "mutation",
    fields: { integration_id: "from /builder/settings.json", event_id: "a failed event's id" },
    required: ["integration_id", "event_id"], effects: ["retry_webhook"],
  }),
  op({
    operation: "community.agent.save", area: "agent", name: "Community agent",
    calls: "communityAgent:saveCommunityAgentConfig", ref: api.communityAgent.saveCommunityAgentConfig, kind: "mutation",
    fields: { community_system_prompt: "how the community's agent behaves", landing_json: "the agent page's opening, as /builder/settings.json shows it" },
    required: [], effects: ["update_community_agent"],
  }),
  op({
    operation: "community.channel.create", area: "channels", name: "Add a channel",
    calls: "communityChannels:createCommunityChannel", ref: api.communityChannels.createCommunityChannel, kind: "mutation",
    fields: { name: "channel name", access_mode: "who can see it, as /builder/settings.json lists the modes" },
    required: ["name"], effects: ["create_channel"],
  }),
  op({
    operation: "community.channel.rename", area: "channels", name: "Rename a channel",
    calls: "communityChannels:renameCommunityChannel", ref: api.communityChannels.renameCommunityChannel, kind: "mutation",
    fields: { channel_id: "from /builder/settings.json", name: "new name" }, required: ["channel_id", "name"], effects: ["rename_channel"],
  }),
  op({
    operation: "community.channel.move", area: "channels", name: "Move a channel",
    calls: "communityChannels:moveCommunityChannel", ref: api.communityChannels.moveCommunityChannel, kind: "mutation",
    fields: { channel_id: "the channel", after_channel_id: "put it after this one, or null", before_channel_id: "before this one, or null",
      expected_position: "its position now" },
    required: ["channel_id", "after_channel_id", "before_channel_id", "expected_position"], effects: ["reorder_channels"],
  }),
  op({
    operation: "community.channel.pin", area: "channels", name: "Pin a post in a channel",
    calls: "communityChannels:setCommunityChannelPinnedRoot", ref: api.communityChannels.setCommunityChannelPinnedRoot, kind: "mutation",
    fields: { channel_id: "the channel", root_id: "the post to pin, or null to unpin" }, required: ["root_id"], effects: ["pin_post"],
  }),
  op({
    operation: "community.channel.participant.set", area: "channels", name: "Who's in a private channel",
    calls: "communityChannelParticipants:setParticipant", ref: api.communityChannelParticipants.setParticipant, kind: "mutation",
    fields: { channel_id: "the channel", target: '{ "kind": "member", "userId": "<id>" } or { "kind": "community_agent" }', active: "true adds, false removes" },
    required: ["channel_id", "target", "active"], effects: ["set_channel_participant"],
  }),
];

// Hard-to-undo changes (Rashid, 2026-10-25: "Direct, risky ones need Apply").
const proposal = (spec: Omit<BuilderSettingOperation, "review">) => op({ ...spec, review: "owner_apply" });
BUILDER_SETTING_OPERATIONS.push(
  proposal({
    operation: "community.pricing.set", area: "pricing", name: "Change the price",
    calls: "communityLifecycle:saveCommunitySettings", ref: api.communityLifecycle.saveCommunitySettings, kind: "mutation",
    fields: { expected_settings_revision: "settings_revision from /builder/settings.json",
      monthly_amount_base_units: "monthly price in cents, or null for none", annual_amount_base_units: "yearly price in cents, or null for none" },
    required: ["expected_settings_revision"], merge: "community_settings", effects: ["change_price"],
  }),
  proposal({
    operation: "community.free_access.set", area: "pricing", name: "Who can join for free",
    calls: "communityAdmin:setCommunityFreeAccessMode", ref: api.communityAdmin.setCommunityFreeAccessMode, kind: "mutation",
    fields: { mode: "open (anyone joins) or approval (you approve each request)" }, required: ["mode"], effects: ["change_free_access"],
  }),
  proposal({
    operation: "community.archive", area: "general", name: "Archive the community",
    calls: "communityColdArchive:archiveCommunity", ref: api.communityColdArchive.archiveCommunity, kind: "mutation",
    fields: {}, required: [], effects: ["archive_community"],
  }),
  proposal({
    operation: "community.restore", area: "general", name: "Restore the archived community",
    calls: "communityColdArchive:restoreCommunityWithoutPayment", ref: api.communityColdArchive.restoreCommunityWithoutPayment, kind: "mutation",
    fields: { lifecycle_generation: "the archive's lifecycle generation" }, required: ["lifecycle_generation"], effects: ["restore_community"],
  }),
  proposal({
    operation: "community.access.end", area: "access", name: "End access you gave",
    calls: "communityAccess:endCommunityAccess", ref: api.communityAccess.endCommunityAccess, kind: "mutation",
    fields: { membership_id: "the member" }, required: ["membership_id"], effects: ["end_owner_access"],
  }),
  proposal({
    operation: "community.access.license_key.revoke", area: "access", name: "Revoke a license key",
    calls: "communityAccess:revokeClientLicenseKeyForOwner", ref: api.communityAccess.revokeClientLicenseKeyForOwner, kind: "mutation",
    fields: { membership_id: "the member whose key stops working" }, required: ["membership_id"], effects: ["revoke_license_key"],
  }),
  proposal({
    operation: "community.access.integration.revoke", area: "access", name: "Disconnect a connected service",
    calls: "communityAccess:revokeAccessIntegration", ref: api.communityAccess.revokeAccessIntegration, kind: "mutation",
    fields: { integration_id: "from /builder/settings.json" }, required: ["integration_id"], effects: ["revoke_access_integration"],
  }),
  proposal({
    operation: "community.workflow.stage.delete", area: "workflows", name: "Delete a workflow stage",
    calls: "communityMemberWorkflows:deleteBuilderWorkflowMilestone", ref: api.communityMemberWorkflows.deleteBuilderWorkflowMilestone, kind: "mutation",
    fields: { expected_revision: "workflow revision", milestone_key: "the stage's key" }, required: ["expected_revision", "milestone_key"],
    effects: ["delete_workflow_stage"],
  }),
  proposal({
    operation: "community.workflow.member.force", area: "workflows", name: "Move a member past a stage without its checks",
    calls: "communityMemberWorkflows:forceBuilderMemberMilestone", ref: api.communityMemberWorkflows.forceBuilderMemberMilestone, kind: "mutation",
    fields: { membership_id: "the member", expected_workflow_id: "from the member's workflow context", expected_workflow_revision: "workflow revision",
      expected_milestone_key: "the stage they're in now", expected_milestone_entered_at: "when they entered it (ms)",
      expected_activation_sequence: "from the member's workflow context", expected_transition_seq: "from the member's workflow context" },
    required: ["membership_id", "expected_workflow_id", "expected_workflow_revision", "expected_milestone_key", "expected_milestone_entered_at",
      "expected_activation_sequence", "expected_transition_seq"],
    effects: ["force_member_stage"],
  }),
  proposal({
    operation: "community.channel.delete", area: "channels", name: "Delete a channel",
    calls: "communityChannels:deleteCommunityChannel", ref: api.communityChannels.deleteCommunityChannel, kind: "mutation",
    fields: { channel_id: "from /builder/settings.json" }, required: ["channel_id"], effects: ["delete_channel"],
  }),
  proposal({
    operation: "community.channel.access.set", area: "channels", name: "Change who can see a channel",
    calls: "communityChannels:setChannelAccess", ref: api.communityChannels.setChannelAccess, kind: "mutation",
    fields: { channel_id: "the channel", access_mode: "the new mode", expected_access_mode: "its mode now",
      acknowledge_history_exposure: "true when opening it shows its past posts to more people" },
    required: ["channel_id", "access_mode", "expected_access_mode", "acknowledge_history_exposure"], effects: ["change_channel_access"],
  }),
  proposal({
    operation: "community.member.role.set", area: "members", name: "Change a member's role",
    calls: "communityAdmin:setCommunityMemberRole", ref: api.communityAdmin.setCommunityMemberRole, kind: "mutation",
    fields: { target_membership_id: "the member", role: "admin, moderator or member" }, required: ["target_membership_id", "role"],
    effects: ["change_member_role"],
  }),
  proposal({
    operation: "community.member.remove", area: "members", name: "Remove a member",
    calls: "communityAdmin:removeCommunityMember", ref: api.communityAdmin.removeCommunityMember, kind: "action",
    fields: { target_membership_id: "the member" }, required: ["target_membership_id"], effects: ["remove_member"],
  }),
  proposal({
    operation: "community.member.ban", area: "members", name: "Ban a member",
    calls: "communityAdmin:banCommunityMember", ref: api.communityAdmin.banCommunityMember, kind: "action",
    fields: { target_membership_id: "the member", reason: "why (kept in the history)" }, required: ["target_membership_id"],
    effects: ["ban_member"],
  }),
);

// Writes the web app makes that are not an operation above, and why. A public
// mutation or action the app calls that is in neither list fails the parity test.
// Reasons start with one of: "agent path:" (another MCP path does it),
// "human only:" or "not a setting:".
export const SETTINGS_UI_WRITES_WITHOUT_AGENT_PATH: Record<string, string> = {
  // Other MCP paths already do these.
  "communityClients:createClientProperty": "agent path: community.client.property.define",
  "communityClients:updateClientProperty": "agent path: community.client.property.define (with key)",
  "communityThemes:saveCommunityThemeDraft": "agent path: community.theme.save_draft",
  "communityThemes:publishCommunityThemeDraft": "agent path: community.theme.publish",
  "communityThemes:discardCommunityThemeDraft": "agent path: save the published theme as the draft",
  "communityLayouts:saveCommunityLayoutDraft": "agent path: community.layout.save_draft",
  "communityLayouts:publishCommunityLayoutDraft": "agent path: community.layout.publish",
  "communityLayouts:discardCommunityLayoutDraft": "agent path: save the published layout as the draft",
  "communityResources:saveCommunityResource": "agent path: builder/resources changesets, applied by the owner",
  "communityResources:saveCommunityResourceModule": "agent path: builder/resources changesets",
  "communityResources:moveCommunityResourceToModule": "agent path: builder/resources changesets (move_resource)",
  "communityResources:reorderCommunityResources": "agent path: builder/resources changesets",
  "communityResources:reorderCommunityResourceModules": "agent path: builder/resources changesets",
  "communityResources:deleteCommunityResource": "agent path: builder/resources changesets (delete_page)",
  "communityResources:deleteCommunityResourceModule": "agent path: builder/resources changesets (delete_category)",
  "communitySettingProposals:applyCommunitySettingProposal": "human only: the owner applies what an agent proposed",
  "communitySettingProposals:rejectCommunitySettingProposal": "human only: the owner rejects what an agent proposed",
  "communityResources:applyCommunityResourceBuilderChangeset": "human only: the owner applies what an agent staged",
  "communityResources:rejectCommunityResourceBuilderChangeset": "human only: the owner rejects what an agent staged",
  "communityAdmin:approveCommunityJoinRequest": "agent path: community.admission.approve",
  "communityAdmin:denyCommunityJoinRequest": "agent path: community.admission.deny",
  "communityMemberWorkflows:approveBuilderMemberMilestone": "agent path: community.workflow.approve_milestone",
  "communityAccess:createAccessIntegration": "human only: the API key and signing secret are shown once, to the owner",
  "communityAccess:rotateAccessIntegrationSecret": "human only: the new secret is shown once, to the owner",
  // Can't be done by an agent.
  "creatorCommerce:startConnectOnboarding": "human only: Stripe verifies the owner in person; an agent can only hand over the link",
  "founderBilling:startFounderSubscriptionCheckout": "human only: the founder pays with their own card",
  "founderBilling:startFounderBillingPortal": "human only: the founder's own billing portal",
  "founderBilling:startPublicBuilderCheckout": "human only: the founder pays with their own card",
  "communityLifecycle:createCommunity": "human only: creating a community needs the founder's paid plan checkout",
  "communityResources:beginGitHubSourceOAuth": "human only: signing in to GitHub",
  "communityResources:finalizeGitHubSourceOAuth": "human only: signing in to GitHub",
  "communityResources:beginGoogleDriveSourceOAuth": "human only: signing in to Google",
  "communityResources:finalizeGoogleDriveSourceOAuth": "human only: signing in to Google",
  "communityIntegrationActions:requestConnection": "human only: signing in to a connected app",
  "communityIntegrationActions:verifyConnection": "human only: signing in to a connected app",
  // Not a community setting: a person's own actions, imports and the owner's tools.
  "communityResources:disconnectGitHubSourceConnection": "not a setting: the owner's own GitHub sign-in",
  "communityResources:disconnectGoogleDriveSourceConnection": "not a setting: the owner's own Google sign-in",
  "communityResources:listGitHubSourceRepositories": "not a setting: browsing the owner's GitHub",
  "communityResources:listGitHubSourceFiles": "not a setting: browsing the owner's GitHub",
  "communityResources:listGoogleDriveSourceFiles": "not a setting: browsing the owner's Drive",
  "communityResources:importGitHubSourceFiles": "not a setting: importing files (agents push with polynet push)",
  "communityResources:importGoogleDriveSourceFiles": "not a setting: importing files (agents push with polynet push)",
  "communityResources:generateCommunityResourceSourceUploadUrl": "not a setting: uploading source files",
  "communityResources:ingestCommunitySources": "not a setting: indexing uploaded sources",
  "communityResources:crawlCommunitySourceRoot": "not a setting: indexing a website",
  "communityResources:resolveCommunityResourceImageUrl": "not a setting: reads an image link",
  "communityBuilderKnowledgeSetup:buildBuilderKnowledgeResources": "not a setting: first-run setup",
  "communityBuilderKnowledgeSetup:completeBuilderKnowledgeSetup": "not a setting: first-run setup",
  "communityIntegrationActions:disconnect": "not a setting: the owner's own connected app",
  "communityIntegrationConnections:setPilotEnabled": "not a setting: Polynet's own pilot switch",
  "communityMemberWorkflows:retryBuilderMemberGoalReview": "not a setting: one member's review on the board",
  "communityMemberWorkflows:retryBuilderMemberWorkflowAction": "not a setting: one member's automation on the board",
  "communityMemberWorkflows:setBuilderMemberServiceChannel": "not a setting: one member's service channel on the board",
  "communityTestMembers:startTestMember": "not a setting: the owner's test run",
  "communityTestMembers:endTestMember": "not a setting: the owner's test run",
  "communityTestMembers:runTestMemberTimedStepsNow": "not a setting: the owner's test run",
  "communityEvents:saveCommunityEvent": "not a setting: the Events page (and it isn't scoped to one community yet)",
  "communityEvents:cancelCommunityEvent": "not a setting: the Events page",
  "communityAccess:createMyCommunityLicenseKey": "not a setting: a member's own license key",
  "communityAdmin:saveCommunityMemberSettings": "not a setting: a member's own notifications",
  "communityAdmin:leaveCommunity": "not a setting: a member leaving",
  "communityAdmin:syncCommunityMembershipCount": "not a setting: a count refresh",
  "communityLayouts:setMyCommunityLayoutChoice": "not a setting: a member's own Display choice",
  "communityAttention:acknowledgeCommunityChatRead": "not a setting: read markers",
  "communityAttention:markCommunitySurfaceSeen": "not a setting: read markers",
  "communityChat:createThreadUserMessage": "not a setting: chatting",
  "communityChat:setCommunityTyping": "not a setting: chatting",
  "communityChat:clearCommunityTyping": "not a setting: chatting",
  "communityInteractions:createCommunityInteractionComposerMessage": "not a setting: posting",
  "communityInteractions:editCommunityInteractionMessage": "not a setting: posting",
  "communityInteractions:deleteCommunityInteractionMessage": "not a setting: posting",
  "communityInteractions:toggleCommunityInteractionReaction": "not a setting: reacting (agents use community.interaction.react)",
  "communityEmbedValues:saveOwnEmbedValue": "not a setting: a member's own widget answers",
  "communityFormRequests:saveMyAnswers": "not a setting: a member's own form answers (agents use community.form.submit)",
  "communityResourceProgress:setOwnLessonResponse": "not a setting: a member's own lesson answers",
  "communityResourceProgress:setOwnResourceProgressStatus": "not a setting: a member's own progress",
  "communityCommerce:startPublicCommunityCheckout": "not a setting: a visitor paying",
  "communityCommerce:redeemPurchaseClaim": "not a setting: a visitor paying",
  "communityCommerce:redeemPendingPurchaseClaims": "not a setting: a visitor paying",
  "communityPublic:joinPublicCommunity": "not a setting: a visitor joining",
  "communityPublic:joinPublicCommunityBySlug": "not a setting: a visitor joining",
  "communityPublic:cancelMyJoinRequestBySlug": "not a setting: a visitor joining",
  "communityPublic:heartbeatCommunityPresence": "not a setting: presence",
  "communityPublic:recordPublicFunnelVisitBySlug": "not a setting: visit counts",
  "businessAnalytics:identifyBusinessVisitor": "not a setting: analytics",
  "businessAnalytics:recordBusinessPageVisit": "not a setting: analytics",
  "directMessages:*": "not a setting: direct messages",
  "threads:*": "not a setting: conversations with the agent",
  "profiles:*": "not a setting: a person's own profile",
  "emailPreferences:updateMyEmailPreferences": "not a setting: a person's own email preferences",
  "auth:bootstrapActor": "not a setting: signing in",
  "memberEntryDestination:resolveMemberEntryDestination": "not a setting: where a member lands",
  "operatorAccess:recordOperatorDashboardAccess": "not a setting: Polynet's operator dashboard",
  "emailDiagnostics:getOperatorEmailAuthDiagnostic": "not a setting: Polynet's operator dashboard",
  "operatorSentryDiagnostics:getOperatorFrontendErrorDiagnostics": "not a setting: Polynet's operator dashboard",
};

export const builderSettingOperation = (operation: string) =>
  BUILDER_SETTING_OPERATIONS.find(candidate => candidate.operation === operation);

const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

// What polynet_call shows the agent for one operation.
export function builderSettingInput(spec: BuilderSettingOperation) {
  const proposing = spec.review === "owner_apply";
  return {
    required: spec.required,
    ...spec.fields,
    ...(proposing ? { note: "optional: one line for the owner on why" } : {}),
    ...(spec.merge ? { guidance: "Leave out what you don't change; it keeps its current value." } : {}),
    ...(proposing ? { review: "owner_apply: this only proposes the change. It happens when the owner taps Apply in the app, within 24 hours." } : {}),
    result: proposing
      ? "the proposal (status staged); read /builder/settings.json proposals for whether it was applied"
      : "what the Settings page gets back after the same save",
    refusals: { invalid_tool_args: "a field that isn't listed, or a required one missing", setting_refused: "the save was refused; message says why (for example a revision conflict)" },
    effects: spec.effects,
    forbidden_effects: proposing ? ["apply_without_owner", "change_other_communities"] : ["change_pricing", "change_other_communities", "delete"],
  };
}

export type BuilderSettingCall = { ok: true; args: Record<string, unknown> } | { ok: false; message: string };

// Turns the agent's input into the mutation's arguments. Only listed fields
// pass; identity and community come from the caller, never from input.
export function builderSettingArgs(spec: BuilderSettingOperation, input: Record<string, unknown>, caller: {
  authSubject: string; userId: string; communityId: string; current?: Record<string, unknown> | null;
}): BuilderSettingCall {
  const unknown = Object.keys(input).filter(key => !(key in spec.fields) && !(key === "note" && spec.review === "owner_apply"));
  if (unknown.length) return { ok: false, message: `Not a field of ${spec.operation}: ${unknown.join(", ")}.` };
  const missing = spec.required.filter(key => input[key] === undefined);
  if (missing.length) return { ok: false, message: `${spec.operation} needs ${missing.join(", ")}.` };
  const args: Record<string, unknown> = {};
  if (spec.merge === "community_settings" && caller.current) {
    args.name = caller.current.name;
    args.slug = caller.current.slug;
  }
  for (const [key, value] of Object.entries(input)) if (value !== undefined && key !== "note") args[camel(key)] = value;
  Object.assign(args, spec.extra ?? {});
  if (spec.community !== false) args.communityId = caller.communityId;
  if (spec.identity === "user") args.userId = caller.userId;
  else args.authSubject = caller.authSubject;
  return { ok: true, args };
}

// /builder/settings.json: everything an agent needs before it saves, read with
// the same queries the Settings pages use. A part the caller can't read is null.
export async function readBuilderSettings(ctx: any, caller: { authSubject: string; communityId: string }) {
  const scope = { authSubject: caller.authSubject, communityId: caller.communityId };
  const read = async (ref: any, extra: Record<string, unknown> = {}) => {
    try { return await ctx.runQuery(ref, { ...scope, ...extra }); } catch { return null; }
  };
  const [general, sales_page, workflows, forms, access_integrations, agent, channels, proposals] = await Promise.all([
    read(api.communityLifecycle.getCommunitySettings),
    read(api.communityFunnel.getCommunityFunnelConfig),
    read(api.communityMemberWorkflows.getBuilderWorkflowBoardPage, { pageSize: 1 }).then(board => board ? board.workflow : null),
    read(api.communityForms.listBuilderForms),
    read(api.communityAccess.listAccessIntegrations),
    read(api.communityAgent.getCommunityAgentConfig),
    read(api.communityChannels.listCommunityChannels),
    read(api.communitySettingProposals.listCommunitySettingProposals),
  ]);
  return {
    contract: "polynet.builder_settings.v1",
    guidance: "Change a setting with polynet_call and its operation from capabilities/. Revisions here are what the expected_* fields want.",
    operations: BUILDER_SETTING_OPERATIONS.map(spec => ({ operation: spec.operation, area: spec.area, name: spec.name,
      ...(spec.review ? { review: spec.review } : {}) })),
    // workflows holds the welcome page and gate too, with the revision both use.
    general, sales_page, workflows, forms, access_integrations, agent, channels,
    // Ready-made stage plans the agent applies with the stage operations, as the
    // Workflows board's "Let your agent lead each member" card does.
    workflow_templates: {
      agent_led_journey: {
        guidance: "Make or reuse the select property in `property` (community.client.property.define), put its key where rules say {journey_property}, "
          + "replace {form_key} with the onboarding form's key (the first stage's join form, else a published form; with none, use the no-form plan), "
          + "then: add the first stage's additions with community.workflow.stage.update, and for each stage community.workflow.stage.create "
          + "followed by community.workflow.stage.update with its rules (keys empty, draft-* action keys kept so sequences link).",
        new_workflow: buildAgentLedJourneyPlan({ hasWorkflow: false, onboardingFormKey: "{form_key}" }),
        new_workflow_no_form: buildAgentLedJourneyPlan({ hasWorkflow: false, onboardingFormKey: null }),
        existing_workflow: buildAgentLedJourneyPlan({ hasWorkflow: true, onboardingFormKey: "{form_key}" }),
      },
    },
    // Changes waiting for the owner's Apply, and recent outcomes.
    proposals,
  };
}

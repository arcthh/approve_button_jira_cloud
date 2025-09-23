import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

/**
 * Configure your custom fields and workflow names here.
 * - APPROVER_CF           : multi-user picker "Approvers"
 * - APPROVAL_DATE_CF      : date/datetime field "Approval Date"
 * - APPROVAL_GIVEN_BY_CF  : single-user picker "Approval given by"
 * - REQUIRED_STATUS       : exact status where Approve button is allowed
 * - TARGET_STATUS         : target status for approval transition
 * - APPROVAL_PROPERTY_KEY : issue property used to tally votes (x/y)
 */
const APPROVER_CF           = 'customfield_10003';
const APPROVAL_DATE_CF      = 'customfield_15694';
const APPROVAL_GIVEN_BY_CF  = 'customfield_15826';
const REQUIRED_STATUS       = 'Ready for Review';
const TARGET_STATUS         = 'Approved';
const APPROVAL_PROPERTY_KEY = 'approvalVotes';

// ---------- small helpers ----------

async function assertOk(res, label) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} failed: ${res.status} ${text}`);
  }
  return res;
}

async function getIssueByKeyOrId(idOrKey) {
  const res = await assertOk(
    api.asUser().requestJira(route`/rest/api/3/issue/${idOrKey}`),
    'Issue fetch'
  );
  return res.json();
}

async function getMyself() {
  const res = await assertOk(api.asUser().requestJira(route`/rest/api/3/myself`), 'myself fetch');
  return res.json();
}

async function getIssuePropertyOrEmpty(issueId, key) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/properties/${key}`);
  if (res.status === 404) return [];
  await assertOk(res, 'Property GET');
  const p = await res.json();
  return Array.isArray(p.value) ? p.value : [];
}

async function putIssueProperty(issueId, key, value) {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueId}/properties/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  await assertOk(res, 'Property PUT');
}

async function updateIssueFields(issueId, fieldsObj) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fieldsObj }),
  });
  await assertOk(res, 'Issue update');
}

// ---------- resolvers ----------

/**
 * getIssueData:
 *  - Returns the view-model for the UI.
 *  - Safe to call frequently (read-only).
 */
resolver.define('getIssueData', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const [issue, me] = await Promise.all([getIssueByKeyOrId(idOrKey), getMyself()]);

  const statusName = issue?.fields?.status?.name || 'Unknown';

  const approvers = Array.isArray(issue?.fields?.[APPROVER_CF])
    ? issue.fields[APPROVER_CF]
    : [];

  const approvalGivenBy = issue?.fields?.[APPROVAL_GIVEN_BY_CF] || null;

  // For display: if the Approval Date is a date-only field, Jira will store YYYY-MM-DD.
  // If it's datetime, it's an ISO string — keep as-is; the UI renders it as plain text.
  const approvalDate = issue?.fields?.[APPROVAL_DATE_CF] || null;

  const votes = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);

  const currentUserIsApprover = approvers.some((u) => u?.accountId === me.accountId);
  const canApprove =
    statusName === REQUIRED_STATUS && approvers.length > 0 && currentUserIsApprover;

  return {
    statusName,
    approvers,
    approvedCount: votes.length,
    totalApprovers: approvers.length,
    hasVoted: votes.includes(me.accountId),
    canApprove,
    approvalGivenBy,
    approvalDate,
  };
});

/**
 * approveIssue:
 *  - Validates status + approver membership.
 *  - Transitions to TARGET_STATUS.
 *  - Sets Approval Date and Approval Given By.
 *  - Appends the current user to approvalVotes issue property.
 */
resolver.define('approveIssue', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const me = await getMyself();
  const issue = await getIssueByKeyOrId(idOrKey);

  const statusName = issue?.fields?.status?.name || 'Unknown';
  const approvers = Array.isArray(issue?.fields?.[APPROVER_CF])
    ? issue.fields[APPROVER_CF]
    : [];

  if (statusName !== REQUIRED_STATUS) {
    throw new Error(`Must be in "${REQUIRED_STATUS}" to approve (current: ${statusName})`);
  }
  if (approvers.length === 0 || !approvers.some((u) => u?.accountId === me.accountId)) {
    throw new Error('Only listed approvers can approve this issue');
  }

  // Fetch available transitions and locate the target by name
  const transRes = await assertOk(
    api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`),
    'Transitions fetch'
  );
  const transitions = (await transRes.json())?.transitions || [];
  const availableTargets = transitions.map((t) => t?.to?.name).filter(Boolean);
  const target = transitions.find(
    (t) => String(t?.to?.name || '').toLowerCase() === TARGET_STATUS.toLowerCase()
  );
  if (!target) {
    throw new Error(
      `No transition to "${TARGET_STATUS}" is available from "${statusName}". ` +
        `Available: ${availableTargets.join(', ') || '(none)'}`
    );
  }

  // Perform transition
  await assertOk(
    api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: target.id } }),
    }),
    'Transition'
  );

  // Set "Approval Date" and "Approval given by"
  // If your Approval Date is date-only, you can send YYYY-MM-DD; ISO works for datetime fields.
  const now = new Date();
  const iso = now.toISOString();
  await updateIssueFields(issue.id, {
    [APPROVAL_DATE_CF]: iso,
    [APPROVAL_GIVEN_BY_CF]: { accountId: me.accountId },
  });

  // Record vote (append unique)
  const votes = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);
  if (!votes.includes(me.accountId)) {
    votes.push(me.accountId);
    await putIssueProperty(issue.id, APPROVAL_PROPERTY_KEY, votes);
  }

  return { message: `Approved by ${me.displayName}` };
});

/**
 * normalizeOnReady:
 *  - When an issue is changed, if it's in REQUIRED_STATUS,
 *    ensure approval state is reset (date=null, givenBy=null, votes=[]).
 *  - Idempotent: calling multiple times is safe.
 */
resolver.define('normalizeOnReady', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  // Read current issue and fields
  const issue = await getIssueByKeyOrId(idOrKey);
  const statusName = issue?.fields?.status?.name || 'Unknown';

  if (statusName !== REQUIRED_STATUS) {
    // Not in "Ready for Review": nothing to reset
    return { normalized: false, statusName };
  }

  const currentDate   = issue?.fields?.[APPROVAL_DATE_CF] || null;
  const currentBy     = issue?.fields?.[APPROVAL_GIVEN_BY_CF] || null;
  const currentVotes  = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);

  const needsReset =
    (currentDate !== null) || (currentBy !== null) || (Array.isArray(currentVotes) && currentVotes.length > 0);

  if (!needsReset) {
    return { normalized: false, statusName };
  }

  // Clear fields and votes (note: requires edit permission for the user)
  await updateIssueFields(issue.id, {
    [APPROVAL_DATE_CF]: null,
    [APPROVAL_GIVEN_BY_CF]: null,
  });

  await putIssueProperty(issue.id, APPROVAL_PROPERTY_KEY, []); // empty array

  return { normalized: true, statusName };
});

export const handler = resolver.getDefinitions();

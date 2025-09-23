// src/resolvers/index.js
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

const APPROVER_CF           = 'customfield_10003';   // Approvers (multi-user)
const APPROVAL_DATE_CF      = 'customfield_15694';   // Approval Date (date/datetime)
const APPROVAL_GIVEN_BY_CF  = 'customfield_15826';   // Approval given by (single-user)
const REQUIRED_STATUS       = 'Ready for Review';
const TARGET_STATUS         = 'Approved';
const APPROVAL_PROPERTY_KEY = 'approvalVotes';

async function assertOk(res, label) {
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`);
  return res;
}
async function getIssueByKeyOrId(idOrKey) {
  const res = await assertOk(api.asUser().requestJira(route`/rest/api/3/issue/${idOrKey}`), 'Issue fetch');
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
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/properties/${key}`, {
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

// Read-only view model
resolver.define('getIssueData', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const [issue, me] = await Promise.all([getIssueByKeyOrId(idOrKey), getMyself()]);

  const statusName = issue?.fields?.status?.name || 'Unknown';
  const approvers  = Array.isArray(issue?.fields?.[APPROVER_CF]) ? issue.fields[APPROVER_CF] : [];

  const approvalGivenBy = issue?.fields?.[APPROVAL_GIVEN_BY_CF] || null;
  const approvalDate    = issue?.fields?.[APPROVAL_DATE_CF] || null;

  const votes = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);

  const currentUserIsApprover = approvers.some((u) => u?.accountId === me.accountId);
  const canApprove = statusName === REQUIRED_STATUS && approvers.length > 0 && currentUserIsApprover;

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

// Transition + write fields + vote
resolver.define('approveIssue', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const me    = await getMyself();
  const issue = await getIssueByKeyOrId(idOrKey);

  const statusName = issue?.fields?.status?.name || 'Unknown';
  const approvers  = Array.isArray(issue?.fields?.[APPROVER_CF]) ? issue.fields[APPROVER_CF] : [];

  if (statusName !== REQUIRED_STATUS) {
    throw new Error(`Must be in "${REQUIRED_STATUS}" to approve (current: ${statusName})`);
  }
  if (approvers.length === 0 || !approvers.some(u => u?.accountId === me.accountId)) {
    throw new Error('Only listed approvers can approve this issue');
  }

  const transRes = await assertOk(api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`), 'Transitions fetch');
  const transitions = (await transRes.json())?.transitions || [];
  const availableTargets = transitions.map(t => t?.to?.name).filter(Boolean);
  const target = transitions.find(t => String(t?.to?.name || '').toLowerCase() === TARGET_STATUS.toLowerCase());
  if (!target) {
    throw new Error(`No transition to "${TARGET_STATUS}" from "${statusName}". Available: ${availableTargets.join(', ') || '(none)'}`);
  }

  await assertOk(api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: target.id } }),
  }), 'Transition');

  const nowIso = new Date().toISOString(); // if date-only field, convert to YYYY-MM-DD
  await updateIssueFields(issue.id, {
    [APPROVAL_DATE_CF]: nowIso,
    [APPROVAL_GIVEN_BY_CF]: { accountId: me.accountId },
  });

  const votes = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);
  if (!votes.includes(me.accountId)) {
    votes.push(me.accountId);
    await putIssueProperty(issue.id, APPROVAL_PROPERTY_KEY, votes);
  }

  return { message: `Approved by ${me.displayName}` };
});

/**
 * resetApprovalOnReady:
 * Call this (manually or via automation) to clear approval artifacts when the
 * issue re-enters "Ready for Review". We do NOT call this on every event automatically
 * to avoid refresh loops and extra write load.
 */
resolver.define('resetApprovalOnReady', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const issue = await getIssueByKeyOrId(idOrKey);
  const statusName = issue?.fields?.status?.name || 'Unknown';
  if (statusName !== REQUIRED_STATUS) {
    return { reset: false, reason: `Status is ${statusName}` };
  }

  // Clear fields + votes if any are set
  const currentDate  = issue?.fields?.[APPROVAL_DATE_CF] || null;
  const currentBy    = issue?.fields?.[APPROVAL_GIVEN_BY_CF] || null;
  const votes        = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);

  if (!currentDate && !currentBy && votes.length === 0) {
    return { reset: false, reason: 'Already clear' };
  }

  await updateIssueFields(issue.id, {
    [APPROVAL_DATE_CF]: null,
    [APPROVAL_GIVEN_BY_CF]: null,
  });
  await putIssueProperty(issue.id, APPROVAL_PROPERTY_KEY, []);

  return { reset: true };
});

export const handler = resolver.getDefinitions();

import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

const APPROVER_CF = 'customfield_10003';      // Approvers
const APPROVAL_DATE_CF = 'customfield_15694'; // Approval Date

const REQUIRED_STATUS = 'Ready for Review';   // exact case
const TARGET_STATUS   = 'Approved';
const APPROVAL_PROPERTY_KEY = 'approvalVotes';

async function getIssueByKeyOrId(idOrKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${idOrKey}`);
  if (!res.ok) throw new Error(`Issue fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getIssuePropertyOrEmpty(issueId, key) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}/properties/${key}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Property fetch failed: ${res.status} ${await res.text()}`);
  const p = await res.json();
  return Array.isArray(p.value) ? p.value : [];
}

resolver.define('getIssueData', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const issue = await getIssueByKeyOrId(idOrKey);

  const meRes = await api.asUser().requestJira(route`/rest/api/3/myself`);
  const me = await meRes.json();

  const statusName = issue?.fields?.status?.name || 'Unknown';
  const approvers  = Array.isArray(issue?.fields?.[APPROVER_CF]) ? issue.fields[APPROVER_CF] : [];
  const votes      = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);

  const currentUserIsApprover = approvers.some(u => u?.accountId === me.accountId);
  const canApprove =
    statusName === REQUIRED_STATUS && approvers.length > 0 && currentUserIsApprover;

  return {
    statusName,
    approvers,
    approvedCount: votes.length,
    totalApprovers: approvers.length,
    hasVoted: votes.includes(me.accountId),
    canApprove,
  };
});

resolver.define('approveIssue', async ({ payload }) => {
  const idOrKey = payload.issueKey || payload.issueId;
  if (!idOrKey) throw new Error('Missing issueKey/issueId');

  const meRes = await api.asUser().requestJira(route`/rest/api/3/myself`);
  const me = await meRes.json();

  const issue = await getIssueByKeyOrId(idOrKey);
  const statusName = issue?.fields?.status?.name || 'Unknown';
  const approvers  = Array.isArray(issue?.fields?.[APPROVER_CF]) ? issue.fields[APPROVER_CF] : [];

  if (statusName !== REQUIRED_STATUS) {
    throw new Error(`Must be in "${REQUIRED_STATUS}" to approve (current: ${statusName})`);
  }
  if (approvers.length === 0 || !approvers.some(u => u?.accountId === me.accountId)) {
    throw new Error('Only listed approvers can approve this issue');
  }

  // Fetch transitions and show the exact available targets when failing
  const transRes = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`);
  if (!transRes.ok) {
    throw new Error(`Transitions fetch failed: ${transRes.status} ${await transRes.text()}`);
  }
  const transitions = (await transRes.json())?.transitions || [];
  const availableTargets = transitions.map(t => String(t?.to?.name || ''));
  const target = transitions.find(t => String(t?.to?.name || '').toLowerCase() === TARGET_STATUS.toLowerCase());
  if (!target) {
    throw new Error(
      `No transition to "${TARGET_STATUS}" is available from "${statusName}". ` +
      `Available targets now: ${availableTargets.filter(Boolean).join(', ') || '(none)'}`
    );
  }

  // Perform transition
  const doTrans = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: target.id } }),
  });
  if (!doTrans.ok) {
    throw new Error(`Transition failed: ${doTrans.status} ${await doTrans.text()}`);
  }

  // Set Approval Date (ISO; if your field is date-only, send YYYY-MM-DD)
  const nowIso = new Date().toISOString();
  const upd = await api.asUser().requestJira(route`/rest/api/3/issue/${issue.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [APPROVAL_DATE_CF]: nowIso } }),
  });
  if (!upd.ok) {
    throw new Error(`Setting Approval Date failed: ${upd.status} ${await upd.text()}`);
  }

  // Record vote (keeps history across cycles unless you clear it yourself)
  let votes = await getIssuePropertyOrEmpty(issue.id, APPROVAL_PROPERTY_KEY);
  if (!votes.includes(me.accountId)) votes.push(me.accountId);
  const vPut = await api.asUser().requestJira(
    route`/rest/api/3/issue/${issue.id}/properties/${APPROVAL_PROPERTY_KEY}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(votes),
    }
  );
  if (!vPut.ok) {
    throw new Error(`Storing approval vote failed: ${vPut.status} ${await vPut.text()}`);
  }

  return { message: `Approved by ${me.displayName}` };
});

export const handler = resolver.getDefinitions();

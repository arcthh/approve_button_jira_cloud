import React, { useEffect, useState, useCallback } from 'react';
import ForgeReconciler, {
  Button,
  Text,
  Stack,
  SectionMessage,
  Spinner,
  useProductContext,
  Lozenge
} from '@forge/react';
import { requestJira, events } from '@forge/bridge';

// --- Config: replace with your actual field IDs & workflow names ---
const APPROVERS_FIELD_ID = 'customfield_10003';   // "Approvers" custom field
const APPROVAL_DATE_FIELD_ID = 'customfield_10067'; // "Approval Date" custom field
const REQUIRED_STATUS_NAME = 'In Review';         // Status where approval is allowed
const TRANSITION_NAME_ON_APPROVE = 'Approved';    // Transition to fire when approved

// Issue property to track approvals (array of approver accountIds)
// This lets us show x/y approvers without needing another custom field
const APPROVED_PROP_KEY = 'approvalVotes';

// --- Helper function to call Jira REST APIs safely ---
const fetchJson = async (path, init) => {
  const res = await requestJira(path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204) return null;        // handle empty responses
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

function App() {
  // Forge provides context about the issue page
  const context = useProductContext();
  const issueKey =
    context?.platformContext?.issueKey ??
    context?.issueKey ??
    context?.extension?.issue?.key ??
    null;

  // --- Local React state ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [issue, setIssue] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [canShowApprove, setCanShowApprove] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [approvedBy, setApprovedBy] = useState([]); // who has approved so far (accountIds)

  // --- Load issue data + approver property ---
  const load = useCallback(async () => {
    if (!issueKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1) Current user
      const user = await fetchJson('/rest/api/3/myself');
      setCurrentUser(user);

      // 2) Fetch issue fields (Approvers, Approval Date, Status)
      const fieldsQuery = `fields=${encodeURIComponent(
        [APPROVERS_FIELD_ID, APPROVAL_DATE_FIELD_ID, 'status'].join(',')
      )}`;
      const issueData = await fetchJson(`/rest/api/3/issue/${issueKey}?${fieldsQuery}`);
      setIssue(issueData);

      // 3) Fetch approvalVotes property (array of accountIds)
      let votes = [];
      try {
        const prop = await fetchJson(
          `/rest/api/3/issue/${issueKey}/properties/${APPROVED_PROP_KEY}`
        );
        votes = Array.isArray(prop?.value) ? prop.value : [];
      } catch (e) {
        // 404 means property not set yet → ignore
        if (!String(e).startsWith('404')) {
          console.error('Failed to read approvalVotes property:', e);
        }
      }
      setApprovedBy(votes);

      // 4) Visibility logic: show Approve button only if...
      const statusName = issueData?.fields?.status?.name;
      const approversField = issueData?.fields?.[APPROVERS_FIELD_ID] || [];
      const approversArr = Array.isArray(approversField)
        ? approversField
        : approversField
        ? [approversField]
        : [];
      const hasApprovers = approversArr.length > 0;
      const isInReview = statusName === REQUIRED_STATUS_NAME;

      const userId = user?.accountId;
      const isUserAnApprover = approversArr.some(a => a?.accountId === userId);

      setCanShowApprove(isInReview && hasApprovers && isUserAnApprover);
    } catch (e) {
      setError(e.message || String(e));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [issueKey]);

  // Load on mount / when issueKey changes
  useEffect(() => { load(); }, [load]);

  // Reload whenever Jira notifies that the issue changed
  useEffect(() => {
    let unsubscribe = null;
    try {
      unsubscribe = events.on('JIRA_ISSUE_CHANGED', () => {
        load();
      });
    } catch (e) {
      console.error('[APP] Failed to attach JIRA_ISSUE_CHANGED listener', e);
    }
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, [load]);

  // --- Handle Approve button click ---
  const handleApprove = useCallback(async () => {
    if (!issueKey) {
      setLoading(false);
      return;
    }
    try {
      setTransitioning(true);
      setError(null);

      // 1) Look up transition ID by name
      const transResp = await fetchJson(`/rest/api/3/issue/${issueKey}/transitions`);
      const transitions = transResp?.transitions || [];
      const target = transitions.find(t => t.name === TRANSITION_NAME_ON_APPROVE);
      if (!target) throw new Error(`Transition "${TRANSITION_NAME_ON_APPROVE}" not found.`);

      // 2) Perform the workflow transition
      await fetchJson(`/rest/api/3/issue/${issueKey}/transitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: { id: target.id } })
      });

      // 3) Update Approval Date field to now
      const nowIso = new Date().toISOString();
      await fetchJson(`/rest/api/3/issue/${issueKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [APPROVAL_DATE_FIELD_ID]: nowIso } })
      });

      // 4) Update approvalVotes property with this user
      const myId = currentUser?.accountId;
      const prior = Array.isArray(approvedBy) ? approvedBy : [];
      const next = prior.includes(myId) ? prior : [...prior, myId];
      await fetchJson(`/rest/api/3/issue/${issueKey}/properties/${APPROVED_PROP_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next)
      });

      await load(); // refresh panel
    } catch (e) {
      setError(e.message || String(e));
      console.error(e);
    } finally {
      setTransitioning(false);
    }
  }, [issueKey, load, currentUser, approvedBy]);

  // --- Render guards ---
  if (error) {
    return (
      <SectionMessage appearance="error">
        <Text>There was an error loading the issue data: {error}</Text>
      </SectionMessage>
    );
  }
  if (loading) return <Spinner />;
  if (!issueKey) return <Spinner />;

  // --- Derived values for rendering ---
  const statusName = issue?.fields?.status?.name || 'Unknown';
  const isDone = statusName === 'Done';

  const approversField = issue?.fields?.[APPROVERS_FIELD_ID] || [];
  const approvers = Array.isArray(approversField)
    ? approversField
    : approversField
    ? [approversField]
    : [];

  const approverIds = approvers.map(a => a?.accountId).filter(Boolean);
  const totalApprovers = approverIds.length;
  const approvedCount = (Array.isArray(approvedBy) ? approvedBy : []).filter(id =>
    approverIds.includes(id)
  ).length;

  // --- UI ---
  return (
    <>
      <Stack space="medium">
        {/* Status row (inline with lozenge) */}
        <Stack space="small" direction="horizontal" align="center">
          <Text>Status:</Text>
          <Lozenge appearance={statusName === 'Done' ? 'success' : 'inprogress'}>
            {statusName}
          </Lozenge>
        </Stack>

        {/* Approvers row (inline lozenges for each user) */}
        <Stack space="small" direction="horizontal" align="center">
          <Text>Approvers:</Text>
          {approvers.length > 0 ? (
            approvers.map((a, idx) => (
              <Lozenge key={idx} appearance="new">
                {a.displayName}
              </Lozenge>
            ))
          ) : (
            <Lozenge appearance="removed">None</Lozenge>
          )}
        </Stack>

        {/* Main action / state */}
        {isDone ? (
          <SectionMessage appearance="success" title="Approved">
            <Text>
              This issue has been approved by {approvedCount}/{totalApprovers} approvers.
            </Text>
          </SectionMessage>
        ) : canShowApprove ? (
          <Button appearance="primary" isDisabled={transitioning} onClick={handleApprove}>
            {transitioning ? 'Approving…' : 'Approve'}
          </Button>
        ) : (
          <SectionMessage title="Approval not available" appearance="warning">
            <Text>
              The Approve button appears only when the issue is in {REQUIRED_STATUS_NAME},
              has at least one Approver, and you are one of them.
            </Text>
          </SectionMessage>
        )}
      </Stack>
    </>
  );
}

// --- Mount the app into the Forge issue panel ---
ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

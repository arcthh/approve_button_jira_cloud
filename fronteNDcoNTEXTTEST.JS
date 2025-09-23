import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  Button,
  Lozenge,
  SectionMessage,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  // Grab Jira product context (this gives us issue info for the current placement)
  const productCtx = useProductContext();

  // Pull issue key and id from the context
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId = productCtx?.extension?.issue?.id || null;

  // State for API data
  const [loading, setLoading] = useState(true);      // loading spinner state
  const [gate, setGate] = useState(null);            // holds issue data from resolver
  const [error, setError] = useState(null);          // error message from resolver/API
  const [approving, setApproving] = useState(false); // disable button while approving

  // Helper: fetch gate data (status, approvers, votes, etc.) from resolver
  const fetchGate = async () => {
    if (!issueKey && !issueId) return; // context not ready yet
    setLoading(true);
    setError(null);
    try {
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on mount and whenever issue key/id changes
  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Handler for Approve button click
  const onApprove = async () => {
    setApproving(true);
    try {
      // Call backend resolver to approve
      const resp = await invoke('approveIssue', { issueKey, issueId });

      // Update UI with backend message (e.g., "Approved by Jane Doe")
      setError(null);
      setGate((prev) => ({
        ...prev,
        statusName: 'Approved',
        approvedCount: prev.approvedCount + 1,
        message: resp.message,
      }));

      // Refresh full gate data (to sync votes, approver counts, etc.)
      await fetchGate();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  // Loading state
  if (loading || !gate) return <Text>Loading…</Text>;

  return (
    <Stack space="medium">
      {/* Error display */}
      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {/* Status row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Status:</Text>
        <Lozenge appearance={gate.statusName === 'Approved' ? 'success' : 'inprogress'}>
          {gate.statusName}
        </Lozenge>
      </Stack>

      {/* Approvers row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Approvers:</Text>
        {gate.approvers?.length > 0 ? (
          gate.approvers.map((u, i) => (
            <Lozenge key={i} appearance="new">
              {u.displayName}
            </Lozenge>
          ))
        ) : (
          <Lozenge appearance="removed">None</Lozenge>
        )}
      </Stack>

      {/* Main state/action */}
      {gate.statusName === 'Approved' ? (
        <SectionMessage appearance="success" title="Approved">
          <Text>
            {gate.message
              ? gate.message
              : `Approved by ${gate.approvedCount}/${gate.totalApprovers} approvers`}
          </Text>
        </SectionMessage>
      ) : gate.canApprove ? (
        <Button appearance="primary" isDisabled={approving} onClick={onApprove}>
          {approving ? 'Approving…' : 'Approve'}
        </Button>
      ) : (
        <SectionMessage appearance="warning" title="Approval not available">
          <Text>
            Approve button appears only in “Ready for review”, with approvers set, and if you are
            one of them.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);

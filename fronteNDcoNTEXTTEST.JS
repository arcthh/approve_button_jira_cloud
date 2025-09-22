import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  Button,
  Lozenge,
  SectionMessage,
  Code,
} from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  const productCtx = useProductContext();

  // Correct paths from your context JSON
  const issueKey = productCtx?.extension?.issue?.key || null;
  const issueId = productCtx?.extension?.issue?.id || null;

  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [approving, setApproving] = useState(false);

  const fetchGate = async () => {
    if (!issueKey && !issueId) return;
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

  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  const onApprove = async () => {
    setApproving(true);
    try {
      await invoke('approveIssue', { issueKey, issueId });
      await fetchGate();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  return (
    <Stack space="large">
      <SectionMessage title="Context Debug" appearance="information">
        <Code>{JSON.stringify({ issueKey, issueId }, null, 2)}</Code>
      </SectionMessage>

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {loading || !gate ? (
        <Text>Loading…</Text>
      ) : (
        <Stack space="medium">
          {/* Status */}
          <Stack direction="horizontal" align="center" space="small">
            <Text>Status:</Text>
            <Lozenge appearance={gate.statusName === 'Approved' ? 'success' : 'inprogress'}>
              {gate.statusName}
            </Lozenge>
          </Stack>

          {/* Approvers */}
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

          {/* Main Action */}
          {gate.statusName === 'Approved' ? (
            <SectionMessage appearance="success" title="Approved">
              <Text>
                Approved by {gate.approvedCount}/{gate.totalApprovers} approvers
              </Text>
            </SectionMessage>
          ) : gate.canApprove ? (
            <Button appearance="primary" isDisabled={approving} onClick={onApprove}>
              {approving ? 'Approving…' : 'Approve'}
            </Button>
          ) : (
            <SectionMessage appearance="warning" title="Approval not available">
              <Text>
                Approve button appears only in “In Review” with approvers set, and if you are one of
                them.
              </Text>
            </SectionMessage>
          )}

          {/* Debug: show gate model */}
          <SectionMessage title="Gate Debug" appearance="information">
            <Code>{JSON.stringify(gate, null, 2)}</Code>
          </SectionMessage>
        </Stack>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);

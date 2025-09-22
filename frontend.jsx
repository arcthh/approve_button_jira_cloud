// src/frontend/index.jsx
// UI Kit 2 frontend for an issueContext module.
// - Vanilla, idiomatic React + @forge/react
// - Only UI components available in @forge/react (forge/ui is deprecated)
// - Talks to backend resolvers via @forge/bridge.invoke

import React, { useEffect, useMemo, useState } from 'react';
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
  // UI Kit 2 way to access Jira context info for the current location.
  // In issueContext, sometimes you get issueKey, sometimes only issueId.
  const productCtx = useProductContext();

  // Try to resolve the issue key from multiple plausible paths.
  // If the key is missing but you have an ID, we’ll still work by sending the ID to the resolver.
  const issueKey = useMemo(() => {
    return (
      productCtx?.extensionContext?.issueKey ||
      productCtx?.extensionContext?.issue?.key ||
      productCtx?.platformContext?.issueKey ||
      null
    );
  }, [productCtx]);

  // Same for the numeric/opaque issue id. REST accepts either key or id.
  const issueId = useMemo(() => {
    return (
      productCtx?.extensionContext?.issueId ||
      productCtx?.extensionContext?.issue?.id ||
      productCtx?.platformContext?.issueId ||
      null
    );
  }, [productCtx]);

  // Local view-model state
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState(null);
  const [error, setError] = useState(null);
  const [approving, setApproving] = useState(false);

  // Helper: fetch latest gate/data from backend.
  const fetchGate = async () => {
    // If neither key nor id is available yet, show a harmless placeholder.
    if (!issueKey && !issueId) {
      setGate(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // IMPORTANT: send whichever of (issueKey, issueId) we have. Resolver is written to handle both.
      const data = await invoke('getIssueData', { issueKey, issueId });
      setGate(data);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // Load gate on mount and whenever the context (key/id) changes.
  useEffect(() => {
    fetchGate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey, issueId]);

  // Click handler for Approve
  const onApprove = async () => {
    if (!gate) return;
    setApproving(true);
    setError(null);
    try {
      await invoke('approveIssue', { issueKey, issueId });
      // Re-fetch to update status/approvals
      await fetchGate();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  // --- RENDER ---

  // Always render a small debug header so you can see what context is available.
  // This helps explain cases where "issue key" is not present but "issue id" is.
  const DebugHeader = (
    <Stack space="small">
      <Text>
        <strong>Context:</strong>{' '}
        {issueKey ? `issueKey=${issueKey}` : issueId ? `issueId=${issueId}` : '(no key/id yet)'}
      </Text>
    </Stack>
  );

  // If context hasn’t delivered either key or id yet, show a gentle message.
  if (!issueKey && !issueId) {
    return (
      <Stack space="medium">
        {DebugHeader}
        <SectionMessage title="Waiting for issue context" appearance="information">
          <Text>
            This context sometimes initializes in two steps. Once Jira provides either an issue key
            or id, the approval UI will load automatically.
          </Text>
        </SectionMessage>
      </Stack>
    );
  }

  return (
    <Stack space="large">
      {DebugHeader}

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {loading || !gate ? (
        <Text>Loading…</Text>
      ) : (
        <Stack space="medium">
          {/* Status row with a lozenge. Green if Approved; in-progress otherwise. */}
          <Stack direction="horizontal" align="center" space="small">
            <Text>Status:</Text>
            <Lozenge appearance={gate.statusName === 'Approved' ? 'success' : 'inprogress'}>
              {gate.statusName || 'Unknown'}
            </Lozenge>
          </Stack>

          {/* Approvers rendered as inline lozenges (names).
              If empty, show a "None" lozenge for clarity. */}
          <Stack direction="horizontal" align="center" space="small">
            <Text>Approvers:</Text>
            {Array.isArray(gate.approvers) && gate.approvers.length > 0 ? (
              gate.approvers.map((u, i) => (
                <Lozenge key={i} appearance="new">
                  {u.displayName}
                </Lozenge>
              ))
            ) : (
              <Lozenge appearance="removed">None</Lozenge>
            )}
          </Stack>

          {/* Main state / action area.
             - If already Approved: show a success message with x/y tally.
             - Else if user can approve: show the Approve button.
             - Else: explain why the button isn’t available. */}
          {gate.statusName === 'Approved' ? (
            <SectionMessage appearance="success" title="Approved">
              <Text>
                This issue has been approved by {gate.approvedCount}/{gate.totalApprovers}{' '}
                approvers.
              </Text>
            </SectionMessage>
          ) : gate.canApprove ? (
            <Button appearance="primary" isDisabled={approving} onClick={onApprove}>
              {approving ? 'Approving…' : 'Approve'}
            </Button>
          ) : (
            <SectionMessage title="Approval not available" appearance="warning">
              <Text>
                The Approve button appears only when the issue is in <i>In Review</i>, has at least
                one Approver, and you are one of them.
              </Text>
            </SectionMessage>
          )}

          {/* Temporary, developer-friendly gate dump for quick diagnosis.
             Remove this once your logic is stable. */}
          <SectionMessage title="Gate (debug)" appearance="information">
            <Code>
              {JSON.stringify(
                {
                  statusName: gate.statusName,
                  canApprove: gate.canApprove,
                  approvedCount: gate.approvedCount,
                  totalApprovers: gate.totalApprovers,
                  hasVoted: gate.hasVoted,
                },
                null,
                2
              )}
            </Code>
          </SectionMessage>
        </Stack>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);

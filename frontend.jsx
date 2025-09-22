import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Lozenge, Button, SectionMessage, Stack } from '@forge/react';
import { view, invoke } from '@forge/bridge';

function App() {
  const [data, setData] = useState(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await view.getContext();
      const resp = await invoke('getIssueData', { issueKey: ctx.extension.issue.key });
      setData(resp);
    })();
  }, []);

  const handleApprove = async () => {
    setTransitioning(true);
    try {
      const ctx = await view.getContext();
      await invoke('approveIssue', { issueKey: ctx.extension.issue.key });
      // Refresh after approve
      const updated = await invoke('getIssueData', { issueKey: ctx.extension.issue.key });
      setData(updated);
    } finally {
      setTransitioning(false);
    }
  };

  if (!data) return <Text>Loading...</Text>;

  const { statusName, approvers, approvedCount, totalApprovers, canApprove } = data;
  const isDone = statusName === 'Approved';

  return (
    <Stack space="medium">
      {/* Status row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Status:</Text>
        <Lozenge appearance={isDone ? 'success' : 'inprogress'}>{statusName}</Lozenge>
      </Stack>

      {/* Approvers row */}
      <Stack direction="horizontal" align="center" space="small">
        <Text>Approvers:</Text>
        {approvers.length > 0 ? (
          approvers.map((a, idx) => (
            <Lozenge key={idx} appearance="new">{a.displayName}</Lozenge>
          ))
        ) : (
          <Lozenge appearance="removed">None</Lozenge>
        )}
      </Stack>

      {/* Main state */}
      {isDone ? (
        <SectionMessage appearance="success" title="Approved">
          <Text>
            This issue has been approved by {approvedCount}/{totalApprovers} approvers.
          </Text>
        </SectionMessage>
      ) : canApprove ? (
        <Button appearance="primary" isDisabled={transitioning} onClick={handleApprove}>
          {transitioning ? 'Approving…' : 'Approve'}
        </Button>
      ) : (
        <SectionMessage title="Approval not available" appearance="warning">
          <Text>
            The Approve button appears only when the issue is in {REQUIRED_STATUS},
            has at least one Approver, and you are one of them.
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);

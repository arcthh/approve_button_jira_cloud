import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  useProductContext,
  Text, Button, Lozenge, SectionMessage, Stack, Code
} from '@forge/react';
import { invoke } from '@forge/bridge'; // ok to use in UI Kit for resolvers

function App() {
  const productCtx = useProductContext(); // <-- UI Kit way to get context
  const issueKey = productCtx?.extensionContext?.issueKey;

  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState(null);
  const [err, setErr] = useState(null);

  // 1) PROVE RENDERING: always show a basic button
  // If you don't see THIS button, the problem is not your gate logic.
  const basic = (
    <Stack space="small">
      <Text>Issue: {issueKey || '(no issue key yet)'}</Text>
      <Button onClick={() => alert('Hello from issueContext ✅')}>Test Button</Button>
    </Stack>
  );

  useEffect(() => {
    (async () => {
      if (!issueKey) return;           // wait until we have the key
      setLoading(true);
      setErr(null);
      try {
        const data = await invoke('getIssueData', { issueKey });
        setGate(data);
      } catch (e) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [issueKey]);

  // Minimal approve action
  const onApprove = async () => {
    try {
      await invoke('approveIssue', { issueKey });
      const data = await invoke('getIssueData', { issueKey });
      setGate(data);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  };

  if (!issueKey) return basic; // show the test button while context loads

  return (
    <Stack space="large">
      {basic}

      {err && (
        <SectionMessage appearance="error" title="Error">
          <Text>{err}</Text>
        </SectionMessage>
      )}

      {loading ? (
        <Text>Loading gate…</Text>
      ) : gate ? (
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
            {gate.approvers?.length ? (
              gate.approvers.map((a, i) => <Lozenge key={i} appearance="new">{a.displayName}</Lozenge>)
            ) : (
              <Lozenge appearance="removed">None</Lozenge>
            )}
          </Stack>

          {/* Gate debug (so you can see WHY it’s hidden) */}
          <SectionMessage title="Gate debug (temporary)" appearance="information">
            <Code>
              {JSON.stringify({
                canApprove: gate.canApprove,
                approvedCount: gate.approvedCount,
                totalApprovers: gate.totalApprovers,
                hasVoted: gate.hasVoted
              }, null, 2)}
            </Code>
          </SectionMessage>

          {/* Conditional Approve */}
          {gate.statusName === 'Approved' ? (
            <SectionMessage appearance="success" title="Approved">
              <Text>
                Approved {gate.approvedCount}/{gate.totalApprovers}
              </Text>
            </SectionMessage>
          ) : gate.canApprove ? (
            <Button appearance="primary" onClick={onApprove}>Approve</Button>
          ) : (
            <SectionMessage appearance="warning" title="Approval not available">
              <Text>
                Button shows only when status is “In Review”, at least one Approver is set,
                and you are one of them.
              </Text>
            </SectionMessage>
          )}
        </Stack>
      ) : (
        <Text>No data</Text>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<App />);

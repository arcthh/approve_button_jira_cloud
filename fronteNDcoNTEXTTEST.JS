import React from 'react';
import ForgeReconciler, {
  useProductContext,
  Stack,
  Text,
  SectionMessage,
  Code,
} from '@forge/react';

function App() {
  // UI Kit 2 hook that gives Jira context for this extension placement
  const productCtx = useProductContext();

  // Safely stringify the context object
  const ctxDump = JSON.stringify(productCtx ?? {}, null, 2);

  return (
    <Stack space="large">
      <Text>🛠 Debug: Raw Product Context</Text>

      <SectionMessage title="productCtx JSON" appearance="information">
        <Code>{ctxDump}</Code>
      </SectionMessage>

      <Text>
        Copy the JSON you see above and paste it here in chat — I’ll tell you
        exactly which field (`issueKey` or `issueId`) to read from for your site.
      </Text>
    </Stack>
  );
}

ForgeReconciler.render(<App />);

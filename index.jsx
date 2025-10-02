/** @jsxImportSource @forge/react */
import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Text, Lozenge } from '@forge/react';
import { view, requestJira } from '@forge/bridge';

const View = () => {
  const [timeElapsed, setTimeElapsed] = useState(null);
  const [sourceTime, setSourceTime] = useState(null);
  const [destinationTime, setDestinationTime] = useState(null);
  const [elapsedFromSource, setElapsedFromSource] = useState(null);
  const [error, setError] = useState(null);
  const [sourceStatusName, setSourceStatusName] = useState('');
  const [destinationStatusName, setDestinationStatusName] = useState('');

  // Helper to format seconds -> "Xh Ym Zs"
  const formatDuration = (seconds) => {
    if (seconds == null) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  useEffect(() => {
    const fetchTimeElapsed = async () => {
      try {
        // 1) Get context + config (NOTE: keys must match context-config.jsx)
        const context = await view.getContext();
        const issueKey = context?.extension?.issue?.key;
        const config = context?.extension?.configuration || {};

        // Consistent keys with your config page
        const sourceStatus = config.sourceStatus || 'To Do';
        const destinationStatus = config.destinationStatus || 'In Progress';
        const transitionType = config.transitionType || 'first';

        // For UI display
        setSourceStatusName(sourceStatus);
        setDestinationStatusName(destinationStatus);

        // 2) Get created date & initial status
        const issueResponse = await requestJira(
          `/rest/api/3/issue/${issueKey}?fields=status,created`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );
        const issueData = await issueResponse.json();
        const issueCreated = issueData?.fields?.created;
        const initialStatus = issueData?.fields?.status?.name;

        // 3) Fetch changelog to find status transitions
        const response = await requestJira(
          `/rest/api/3/issue/${issueKey}/changelog`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );
        const changelog = await response.json();

        let sourceTransitions = [];
        let destinationTransitions = [];
        let sourceTransitionDates = [];
        let destinationTransitionDates = [];

        // Iterate changelog → collect transitions by status name (toString)
        for (const history of (changelog?.values || [])) {
          for (const item of (history.items || [])) {
            if (item.field === 'status') {
              if (item.toString === sourceStatus) {
                sourceTransitions.push(new Date(history.created).getTime());
                sourceTransitionDates.push(history.created);
              }
              if (item.toString === destinationStatus) {
                destinationTransitions.push(new Date(history.created).getTime());
                destinationTransitionDates.push(history.created);
              }
            }
          }
        }

        // Edge case: if issue started in source status, treat "created" as entry into source
        if (sourceTransitions.length === 0 && initialStatus === sourceStatus && issueCreated) {
          sourceTransitions.push(new Date(issueCreated).getTime());
          sourceTransitionDates.push(issueCreated);
        }

        // 4) Choose first/last transitions per your config
        let sourceTimeVal = null;
        let destinationTimeVal = null;
        let sourceDateStr = null;
        let destinationDateStr = null;

        if (transitionType === 'first') {
          if (sourceTransitions.length > 0) {
            sourceTimeVal = sourceTransitions[0];
            sourceDateStr = sourceTransitionDates[0];
          }
          if (destinationTransitions.length > 0) {
            destinationTimeVal = destinationTransitions[0];
            destinationDateStr = destinationTransitionDates[0];
          }
        } else if (transitionType === 'last') {
          if (sourceTransitions.length > 0) {
            sourceTimeVal = sourceTransitions[sourceTransitions.length - 1];
            sourceDateStr = sourceTransitionDates[sourceTransitionDates.length - 1];
          }
          if (destinationTransitions.length > 0) {
            destinationTimeVal = destinationTransitions[destinationTransitions.length - 1];
            destinationDateStr = destinationTransitionDates[destinationTransitionDates.length - 1];
          }
        }

        // Show chosen timestamps for reference
        setSourceTime(sourceDateStr);
        setDestinationTime(destinationDateStr);

        // 5) Compute elapsed seconds
        if (sourceTimeVal) {
          if (destinationTimeVal) {
            setTimeElapsed(Math.floor((destinationTimeVal - sourceTimeVal) / 1000));
            setElapsedFromSource(null);
          } else {
            setElapsedFromSource(Math.floor((Date.now() - sourceTimeVal) / 1000));
            setTimeElapsed(null);
          }
        } else {
          // No entry into source yet
          setTimeElapsed(null);
          setElapsedFromSource(null);
        }
      } catch (error) {
        setError('Error fetching changelog');
        // eslint-disable-next-line no-console
        console.error('Error fetching changelog:', error);
      }
    };

    fetchTimeElapsed();
  }, []);

  // Render: lozenge with status names, lozenge with time
  return (
    <>
      {error ? (
        <Text>{error}</Text>
      ) : (
        <>
          <Lozenge appearance="default">
            {`${sourceStatusName} → ${destinationStatusName}`}
          </Lozenge>
          <Text />
          <Lozenge appearance="success">
            {timeElapsed != null
              ? formatDuration(timeElapsed)
              : elapsedFromSource != null
              ? formatDuration(elapsedFromSource)
              : '—'}
          </Lozenge>
        </>
      )}
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <View />
  </React.StrictMode>
);

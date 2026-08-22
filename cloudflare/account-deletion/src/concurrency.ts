export function meetingBatches<T>(meetings: T[], maximumConcurrency = 2): T[][] {
  if (!Number.isInteger(maximumConcurrency) || maximumConcurrency < 1) {
    throw new Error('INVALID_MEETING_CONCURRENCY')
  }
  const batches: T[][] = []
  for (let index = 0; index < meetings.length; index += maximumConcurrency) {
    batches.push(meetings.slice(index, index + maximumConcurrency))
  }
  return batches
}

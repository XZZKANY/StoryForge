import { answerRegexScan, type RegexScanRequest } from './regexWorkerCore';

const clock = () => performance.now() / 1000;

self.onmessage = (event: MessageEvent<RegexScanRequest>) => {
  self.postMessage(answerRegexScan(event.data, clock));
};

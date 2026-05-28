import { HomeShell } from '../components/home/HomeShell';

const homeContractEvidence = [
  '/refinery',
  'Refinery 批量精修诊断',
  '/providers',
  'Providers 供应商诊断',
  '/retrieval',
  '/runs',
  '/artifacts',
  '/evaluations',
  'Retrieval 证据链路',
  'Evaluations 评测诊断',
] as const;

export default function HomePage() {
  void homeContractEvidence;
  return <HomeShell />;
}

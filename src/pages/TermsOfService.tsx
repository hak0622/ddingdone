import { Top } from '@toss/tds-mobile'

const SECTIONS = [
  {
    title: '제1조 (목적)',
    body: '이 약관은 띵돈(이하 "서비스")이 제공하는 모임 공동 지출 기록 및 정산 서비스의 이용 조건과 절차, 이용자와 서비스 간의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.',
  },
  {
    title: '제2조 (서비스 내용)',
    body: '서비스는 여행, 식사 등 모임에서 발생한 공동 지출을 기록하고, 참여자 간 정산 금액을 계산하는 기능을 제공합니다. 서비스는 실제 송금을 대행하거나 금융 거래를 처리하지 않으며, 정산 내역 계산 및 기록 보조 도구입니다.',
  },
  {
    title: '제3조 (이용자 의무)',
    body: '이용자는 서비스를 이용할 때 타인의 개인정보를 무단으로 입력하거나, 허위 정보를 기재하거나, 서비스 운영을 방해하는 행위를 해서는 안 됩니다. 이용자가 입력한 닉네임, 지출 내역, 사진 등 콘텐츠에 대한 책임은 이용자 본인에게 있습니다.',
  },
  {
    title: '제4조 (서비스 변경 및 중단)',
    body: '서비스는 운영상 또는 기술상의 필요에 따라 사전 고지 없이 서비스 내용을 변경하거나 중단할 수 있습니다. 서비스 중단으로 인해 발생한 손해에 대해 서비스는 별도의 보상을 제공하지 않습니다.',
  },
  {
    title: '제5조 (면책)',
    body: '서비스는 이용자 간 정산 과정에서 발생하는 분쟁, 금전적 손해, 데이터 손실에 대해 책임을 지지 않습니다. 서비스는 네트워크 불안정, 기기 문제 등 불가항력적 사유로 인한 서비스 장애에 대해 책임을 지지 않습니다.',
  },
  {
    title: '부칙',
    body: '이 약관은 2026년 6월 16일부터 적용됩니다.',
  },
]

export default function TermsOfService() {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>이용약관</Top.TitleParagraph>} />
      <div style={{ padding: '20px 20px 48px' }}>
        <p style={{ fontSize: 13, color: '#888', margin: '0 0 24px' }}>최종 업데이트: 2026년 6월 16일</p>
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#191919', margin: '0 0 8px' }}>{s.title}</p>
            <p style={{ fontSize: 14, color: '#555', margin: 0, lineHeight: 1.7 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </>
  )
}

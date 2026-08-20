import { Top } from '@toss/tds-mobile'

const PRIVACY_POLICY_SECTIONS = [
  {
    title: '1. 수집하는 정보',
    body: '띵돈은 서비스 제공을 위해 Firebase 익명 사용자 ID, 닉네임, 정산방 및 비용 정보, 정산 결과와 이용자가 선택한 대표 사진을 처리합니다. 인증과 보안 과정에서 IP 주소 등의 접속정보가 자동 처리될 수 있습니다.\n\n토스 계정의 실명, 전화번호, 이메일 주소와 앱인토스 기기 ID는 직접 수집하지 않습니다.',
  },
  {
    title: '2. 이용 목적',
    body: '수집한 정보는 사용자 식별, 정산방 운영, 비용 기록 공유, 정산 금액 계산, 사진 관리와 회원 탈퇴 처리에만 사용합니다. 광고 목적으로 사용하거나 판매하지 않습니다.',
  },
  {
    title: '3. 보유 기간과 삭제',
    body: '정보는 서비스 이용 기간 동안 보관하며 삭제 또는 탈퇴 시 파기합니다. 탈퇴하면 닉네임, 멤버 정보와 본인이 작성한 비용이 삭제되고, 혼자 참여한 방은 사진을 포함해 모두 삭제됩니다.\n\n다른 참여자가 있는 방은 공동 기록을 위해 유지됩니다. 정산이 끝난 방에서는 탈퇴자의 이름과 식별값을 “탈퇴한 사용자”로 변경하며, 공동방의 사진·이름·메모는 방이 삭제될 때까지 남을 수 있습니다. 탈퇴 처리 결과는 개인정보를 제거한 뒤 최대 30일 보관합니다.',
  },
  {
    title: '4. 이용자의 권리',
    body: '이용자는 앱에서 닉네임과 본인이 작성한 비용을 수정·삭제하고, 권한이 있는 정산방을 삭제할 수 있습니다. 설정의 “회원 탈퇴”에서 직접 탈퇴할 수 있으며, 추가적인 열람·수정·삭제 요청은 아래 이메일로 문의할 수 있습니다.',
  },
  {
    title: '5. 문의',
    body: '이메일: seounghak062@gmail.com',
  },
]

export default function PrivacyPolicy() {
  return (
    <>
      <Top title={<Top.TitleParagraph size={22}>개인정보처리방침</Top.TitleParagraph>} />
      <main style={{ padding: '20px 20px 48px' }}>
        {PRIVACY_POLICY_SECTIONS.map((section) => (
          <section key={section.title} style={{ marginBottom: 26 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#191919', margin: '0 0 8px' }}>
              {section.title}
            </h2>
            <p style={{ fontSize: 14, color: '#555', margin: 0, lineHeight: 1.75, whiteSpace: 'pre-line' }}>
              {section.body}
            </p>
          </section>
        ))}
      </main>
    </>
  )
}

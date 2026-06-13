# Step 2: photo-upload

## 읽어야 할 파일

- `src/lib/cloudinary.ts` (이미 있으면 내용 확인, 없으면 생성)
- `src/pages/MeetingDetail.tsx` (step1 결과 — 사진 추가 버튼 위치 파악)
- `docs/ARCHITECTURE.md`

TDS 컴포넌트 레퍼런스 필요 시 `docs/skills/tds-mobile.md`에서 검색.

## 환경변수

`.env.local`에 아래 키가 있는지 확인하라. 없으면 TODO 주석만 추가하고 실제 값은 하드코딩하지 마라:
```
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=...
```

## 작업

### 1. `src/lib/cloudinary.ts` 생성 (없으면) 또는 업데이트

Cloudinary unsigned upload 함수.

```ts
/**
 * Cloudinary unsigned upload
 * @returns 업로드된 이미지의 secure_url
 */
export async function uploadImage(file: File): Promise<string> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary 환경변수가 설정되지 않았습니다.')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', uploadPreset)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData }
  )

  if (!res.ok) throw new Error('이미지 업로드 실패')
  const data = await res.json()
  return data.secure_url as string
}
```

### 2. `src/pages/MeetingDetail.tsx` 수정 — 사진 추가 기능

기존 "사진 추가" 버튼(현재 console.log)에 실제 로직 연결.

**구현 흐름:**
```
사진 없음 상태 → "사진 추가" 버튼 클릭
→ <input type="file" accept="image/*" /> 트리거 (useRef로 hidden input 연결)
→ onChange: file 선택 시 uploadImage(file) 호출
→ 업로드 중: 사진 영역에 "업로드 중..." 표시, 버튼 disabled
→ 완료: Firestore meetings/{meetingId} 문서의 photoUrl 업데이트 (updateDoc)
→ 이후: 사진 있음 상태 자동 반영 (onSnapshot 실시간 구독이므로 자동 갱신)
```

**필요한 import:**
```ts
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { uploadImage } from '../lib/cloudinary'
```

**hidden file input 패턴:**
```tsx
const fileInputRef = useRef<HTMLInputElement>(null)

// hidden input
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  style={{ display: 'none' }}
  onChange={handleFileChange}
/>

// 사진 추가 버튼
<button onClick={() => fileInputRef.current?.click()}>
  사진 추가
</button>
```

**handleFileChange:**
```ts
async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file || !id) return
  setUploading(true)
  try {
    const url = await uploadImage(file)
    await updateDoc(doc(db, 'meetings', id), { photoUrl: url })
  } catch (err) {
    console.error('사진 업로드 실패', err)
  } finally {
    setUploading(false)
    // input value 초기화 (같은 파일 재선택 허용)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
}
```

**상태:**
```ts
const [uploading, setUploading] = useState(false)
```

사진 있음 상태 (photoUrl이 있을 때):
```tsx
<img
  src={meeting.photoUrl}
  alt="대표 사진"
  style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
/>
```

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없이 성공
npm run lint    # ESLint 통과
```

## 검증 절차

1. AC 커맨드 실행.
2. cloudinary.ts 파일 존재 확인.
3. MeetingDetail에 hidden file input + handleFileChange 로직 있는지 확인.
4. Cloudinary 환경변수가 .env.local에 없으면 빌드는 되지만 런타임에 에러 메시지 출력됨 — 이는 정상.
5. phases/2-logic/index.json step2 status 업데이트:
   - 성공 → "completed", summary: "cloudinary.ts 업로드 함수 + MeetingDetail 사진 추가 기능 연동 완료"
   - 실패 → "error"

## 금지사항
- eval(), Function() 사용 금지.
- Cloudinary cloud_name, upload_preset을 코드에 하드코딩하지 마라 (반드시 import.meta.env 사용).
- Firebase Storage(getStorage) 사용 금지 — Cloudinary만 사용.

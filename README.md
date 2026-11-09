# EXAONE 스킬 for Claude Code

LG AI연구원의 [EXAONE API](https://docs.exaone.ai/ko/docs/overview)를 Claude Code에서 말로 요청해 쓸 수 있게 해 주는 스킬입니다. K-EXAONE 2.5 채팅과 EXAONE Tabular 분류·회귀 예측을 지원합니다.

API 키는 이 저장소에 포함되어 있지 않으며, 각자 발급받아야 합니다.

## 설치

Windows 11에서 검증했습니다. macOS와 Linux 명령은 아직 실행해 보지 않았습니다.

### 1. 준비물

- Claude Code
- Node.js 18 이상: `node -v`로 확인
- Git
- Windows는 Git for Windows 권장: Git Bash가 있어야 한글이 깨지지 않습니다.

### 2. API 키 발급

[EXAONE API 문서](https://docs.exaone.ai/ko/docs/overview)의 "API Key 발급하기"에서 본인 키를 발급받습니다. 키는 발급 후 30일이 지나면 자동으로 비활성화되므로 그때 다시 발급합니다.

### 3. 스킬 설치

Windows (PowerShell):

```powershell
git clone https://github.com/busanhackerhouse-dao/exaone.git
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force exaone\.claude\skills\exaone "$HOME\.claude\skills\"
```

macOS / Linux:

```bash
git clone https://github.com/busanhackerhouse-dao/exaone.git
mkdir -p ~/.claude/skills && cp -R exaone/.claude/skills/exaone ~/.claude/skills/
```

설치 위치는 `~/.claude/skills/exaone/`이며, 모든 프로젝트에서 사용할 수 있습니다.

### 4. API 키 등록

Windows (PowerShell):

```powershell
setx EXAONE_API_KEY "발급받은_키"
```

macOS / Linux (zsh 기준, bash는 `~/.bashrc`):

```bash
echo 'export EXAONE_API_KEY="발급받은_키"' >> ~/.zshrc
```

등록 후에는 터미널을 새로 열고 Claude Code를 다시 시작합니다. 열려 있던 창에는 새 환경변수가 적용되지 않습니다.

### 5. 설치 확인

Claude Code에서 아래처럼 입력합니다. 처음 실행할 때 나오는 `node` 명령 권한 요청을 허용하면 EXAONE의 답변이 표시됩니다.

```
/exaone 안녕하세요라고 한 문장으로 인사해줘
```

## 사용법

요청에 EXAONE이나 엑사원을 언급하거나 `/exaone`으로 시작하면 됩니다.

| 하고 싶은 일 | 입력 예시 |
|---|---|
| 질문하기 | `/exaone 한국어 존댓말 규칙을 간단히 설명해줘` |
| 문서 요약 | `report.txt를 EXAONE한테 세 줄로 요약시켜줘` |
| 번역·검토 | `이 문단을 엑사원으로 영어로 번역해줘` |
| 답변 비교 | `이 질문에 대한 EXAONE 답과 네 답을 비교해줘` |
| 구조화된 답변 | `EXAONE으로 이 고객 문의를 분류해서 JSON으로 받아줘. 키는 category, urgency` |
| 분류 예측 | `train.csv로 학습해서 test.csv의 churn을 EXAONE Tabular로 예측해줘` |
| 수치 예측 | `train.csv로 학습해서 test.csv의 price를 EXAONE Tabular 회귀로 예측해줘` |

### 추론 강도

요청에 원하는 강도를 함께 적으면 적용됩니다. 예: `effort low로 물어봐줘`

| 값 | 용도 |
|---|---|
| `low` | 빠른 응답이 필요한 단순 질문 |
| `high` (기본값) | 수학·코딩 등 일반적인 작업 |
| `max` | 정확도가 가장 중요할 때. 응답이 느리고 토큰을 많이 씁니다 |

### Tabular CSV 형식

- 학습 CSV: 입력 컬럼과 타깃 컬럼을 모두 포함합니다.
- 예측 CSV: 예측할 행의 입력 컬럼을 넣습니다.
- 타깃 컬럼은 한 번에 하나만 예측합니다.
- 분류는 클래스별 확률, 회귀는 999개 분위수 분포로도 받을 수 있습니다. 요청에 "확률로" 또는 "분위수 분포로"라고 적으세요.

EXAONE은 텍스트 전용이라 이미지는 보낼 수 없고, 호출마다 대화 내용을 기억하지 않습니다. 후속 질문에서는 Claude가 필요한 맥락을 프롬프트에 포함해 보냅니다.

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `/exaone`이 목록에 없음 | 설치 경로가 다르거나 재시작 전 | `~/.claude/skills/exaone/SKILL.md`가 있는지 확인하고 Claude Code를 다시 시작 |
| `EXAONE_API_KEY 환경변수가 설정되어 있지 않습니다` | 키 미등록 또는 등록 전에 연 터미널 | 설치 4단계를 수행하고 터미널을 새로 열기 |
| `API 오류 HTTP 401` | 키가 잘못되었거나 30일이 지나 만료 | 키를 재발급해 다시 등록 |
| `HTTP 429, ...후 재시도` | 초당 1회 제한에 걸림 | 정상 동작. 자동으로 최대 5회 재시도 |
| `빈 응답`, `유효한 JSON이 아닙니다` | 토큰 부족 또는 구조화 출력 실패 | 한 번 다시 요청. 반복되면 effort를 낮춰 요청 |
| 한글이 깨져서 출력됨 | PowerShell 5.1 인코딩 | Windows에 Git for Windows를 설치해 Git Bash 사용 |
| `node`를 찾을 수 없음 | Node.js 미설치 또는 PATH 미등록 | Node.js 18 이상을 설치하고 터미널을 새로 열기 |

## 이용 시 주의사항

자세한 조건은 [EXAONE 이용약관](https://docs.exaone.ai/ko/terms/terms-of-service)을 따릅니다.

- **키 공유 금지:** 약관상 키를 다른 사람에게 공유·양도·대여할 수 없습니다. 키를 git이나 메신저에 올리지 마세요. 유출이 의심되면 바로 재발급을 요청합니다.
- **데이터 학습:** 입력값과 결과물은 모델 학습에 쓰일 수 있습니다. 거부하면 그 시점부터 제외되지만, 이미 반영된 부분은 삭제할 수 없습니다.
- **개인정보:** 타인의 개인정보가 포함된 내용은 입력할 수 없습니다.
- **이용 범위:** 약관은 서비스에 연동해 제3자가 모델을 호출하게 하는 것과 영리 목적 이용을 제한합니다. 업무에 쓸 계획이라면 약관 제2조를 먼저 확인하세요.
- **호출 제한:** 테스트한 키 기준으로 초당 1회, 분당 60회, 하루 86,400회입니다. 여러 요청은 한 번에 하나씩 보내세요.
- **답변 검증:** EXAONE의 답변에도 사실 오류가 있을 수 있으니 중요한 내용은 확인하세요.

이 프로젝트는 LG AI연구원의 공식 제품이 아닙니다.

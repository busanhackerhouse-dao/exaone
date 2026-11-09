---
name: exaone
description: LG AI연구원의 EXAONE API(K-EXAONE 2.5 채팅, EXAONE Tabular 예측)를 호출한다. 사용자가 EXAONE, 엑사원, K-EXAONE에게 질문·요약·번역·검토를 맡기거나 답을 비교해 달라고 할 때, 또는 EXAONE Tabular로 CSV 데이터의 분류·회귀 예측을 하려 할 때 사용한다. 사용자가 EXAONE을 언급하지 않은 일반 작업에는 사용하지 않는다.
argument-hint: "[EXAONE에게 보낼 요청]"
---

# EXAONE API

`scripts/exaone.mjs`로 EXAONE API를 호출한다. 키는 `EXAONE_API_KEY` 환경변수에서 읽으며, 키 값을 출력하거나 파일·명령어에 직접 쓰지 않는다.

사용자 요청: $ARGUMENTS

## 호출 규칙

- 항상 **Bash 도구**로 실행한다. PowerShell 5.1은 한글 출력이 깨질 수 있다.
- Bash 도구의 `timeout`은 `600000`으로 지정한다.
- API 제한이 초당 1회이므로 **병렬로 호출하지 않고 한 번에 하나씩** 실행한다. 429 응답은 스크립트가 자동으로 재시도한다.
- 응답은 stdout, 토큰 사용량과 오류는 stderr로 나온다.

## 채팅 (K-EXAONE 2.5)

한 줄짜리 짧은 프롬프트:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/exaone.mjs" chat --effort low --prompt "질문"
```

여러 줄이거나 따옴표·코드가 들어가는 프롬프트는 Write 도구로 임시 파일(UTF-8)에 쓴 뒤 전달한다. 임시 파일은 스크래치패드가 있으면 그곳에 둔다.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/exaone.mjs" chat --prompt-file prompt.txt
```

| 옵션 | 설명 |
|---|---|
| `--effort low\|high\|max` | 추론 강도. 기본 `high`. 단순 질문은 `low`, `max`는 사용자가 최고 정확도를 원할 때만 |
| `--system TEXT`, `--system-file PATH` | 시스템 프롬프트 |
| `--max-tokens N` | 추론 포함 최대 생성 토큰. 기본 16384, `--json-schema` 사용 시 4096 |
| `--temperature N`, `--top-p N` | 샘플링 설정 |
| `--json-schema PATH` | JSON Schema 파일을 지정해 구조화된 출력 요청. 프롬프트에도 "JSON으로 답해"와 사용할 키를 명시한다. 응답은 JSON 파싱만 검사하므로 필드 값은 직접 확인한다 |
| `--show-reasoning` | 모델의 추론 내용을 stderr로 출력 |
| `--out PATH` | 응답을 UTF-8 파일로 저장 |

EXAONE은 텍스트 전용이고 대화 상태를 기억하지 않는다. 후속 질문에서는 필요한 이전 맥락을 프롬프트에 포함한다.

## Tabular 예측

```bash
node "${CLAUDE_SKILL_DIR}/scripts/exaone.mjs" classify --train train.csv --test test.csv --target churn
node "${CLAUDE_SKILL_DIR}/scripts/exaone.mjs" regress --train train.csv --test test.csv --target price
```

- `classify --output probability`: 클래스별 확률 반환 (기본 `class`)
- `regress --output full`: 999개 분위수 예측 분포 반환 (기본 `point`). 결과가 크므로 `--out`으로 저장한다.
- 타깃 컬럼은 하나만 지정한다.

## 데이터 보호

입력값과 결과물은 EXAONE 모델 학습에 쓰일 수 있다.

- 사용자가 지정하지 않은 파일 내용을 보내지 않는다.
- `.env`, 자격 증명, 비밀 키는 프롬프트에 넣지 않는다.
- 타인의 개인정보가 포함된 입력은 보내지 않는다(약관 금지). 포함 여부가 의심되면 먼저 사용자에게 확인한다.

## 결과 전달

- EXAONE의 답변임을 밝혀 전달한다. 답변을 검증 없이 사실로 단정하지 않는다.
- 비교를 요청받으면 EXAONE 답변과 Claude의 판단을 구분해서 쓴다.

## 종료 코드

| 코드 | 의미 | 대응 |
|---|---|---|
| 1 | API 오류 | stderr 메시지를 사용자에게 전달. 401·403이면 키 재발급 안내(유효기간 30일) |
| 2 | 사용법·설정 오류 | 인자 수정. 키 미설정이면 `EXAONE_API_KEY` 설정 안내 |
| 3 | 빈 응답, 잘린 응답, 유효하지 않은 JSON | 1회만 재시도. 일반 채팅은 `--max-tokens`를 늘리거나 `--effort`를 낮추고, 스키마 모드는 토큰을 늘리지 말고 그대로 재시도 |
| 4 | 네트워크·시간 초과 | 사용자에게 알리고 재시도 여부 확인 |

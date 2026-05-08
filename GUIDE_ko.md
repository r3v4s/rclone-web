# Rclone Web 원격 접속 가이드

이 문서는 Docker 안에서 웹 UI를 실행하면서, 호스트 머신에 이미 설치된 rclone을 사용하는 방법을 설명합니다.

아래 예시는 호스트 머신 IP가 다음 값이라고 가정합니다.

```text
192.168.0.1
```

## Docker에서 호스트 rclone이 바로 보이지 않는 이유

웹 UI가 Docker 컨테이너 안에서 실행되면 `127.0.0.1`은 호스트 머신이 아니라 컨테이너 자기 자신을 의미합니다.

그래서 원격 브라우저나 컨테이너 안에서 아래 주소로는 호스트의 rclone RC에 연결할 수 없습니다.

```text
http://127.0.0.1:5572
```

rclone RC 서버는 브라우저가 직접 열 수 있는 주소로 접근 가능해야 합니다.

```text
http://192.168.0.1:5572
```

## 권장 구성

호스트 머신에서 rclone RC를 직접 실행하고, 모든 네트워크 인터페이스에 바인딩합니다.

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user dev \
  --rc-pass dev \
  --rc-allow-origin http://192.168.0.1:5173
```

그 다음 Docker에서 웹 UI를 실행하고 Vite 개발 서버 포트를 외부에 노출합니다.

```bash
docker run --rm \
  -p 5173:5173 \
  -e RCLONE_BIN=/bin/true \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

같은 네트워크의 다른 브라우저나 다른 PC에서 아래 주소를 엽니다.

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

로그인 후 UI는 아래 rclone RC 서버에 연결됩니다.

```text
http://192.168.0.1:5572
```

## 커스텀 도메인으로 접속하는 경우

도메인으로 Vite 개발 서버에 접속하면 Vite가 허용되지 않은 host 요청을 차단할 수 있습니다.

도메인을 소스 코드에 하드코딩하지 말고, 실행 시 환경변수로 전달하세요.

```bash
RCLONE_WEB_ALLOWED_HOSTS=rc.example.com \
RCLONE_WEB_PUBLIC_ORIGIN=https://rc.example.com \
npm run dev -- --host 0.0.0.0
```

Docker에서 UI를 실행한다면:

```bash
docker run --rm \
  -p 5173:5173 \
  -e RCLONE_BIN=/bin/true \
  -e RCLONE_WEB_ALLOWED_HOSTS=rc.example.com \
  -e RCLONE_WEB_PUBLIC_ORIGIN=https://rc.example.com \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

여러 host를 허용해야 한다면 콤마로 구분합니다.

```bash
RCLONE_WEB_ALLOWED_HOSTS=rc.example.com,192.168.0.1,localhost \
npm run dev -- --host 0.0.0.0
```

rclone RC를 별도로 실행한다면 `--rc-allow-origin`도 공개 UI 주소와 맞춰야 합니다.

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user dev \
  --rc-pass dev \
  --rc-allow-origin https://rc.example.com
```

도메인 기반 로그인 URL은 아래처럼 사용합니다.

```text
https://rc.example.com/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

## "URL is not configured" 메시지가 나올 때

이 메시지는 로그인 페이지에 저장되었거나 전달된 rclone RC URL이 없다는 뜻입니다.

아래 전체 로그인 URL로 접속하세요.

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=dev&pass=dev
```

또는 로그인 화면의 URL 입력칸에 아래 값을 직접 입력합니다.

```text
http://192.168.0.1:5572
```

위 예시 명령을 그대로 사용했다면 계정 정보는 다음과 같습니다.

```text
user: dev
pass: dev
```

## Docker Desktop 대안

Docker Desktop에서는 컨테이너가 호스트를 아래 이름으로 접근할 수 있는 경우가 많습니다.

```text
host.docker.internal
```

하지만 이 앱은 브라우저 클라이언트가 rclone RC로 직접 요청을 보냅니다.
즉, URL은 컨테이너 안에서만 접근 가능하면 안 되고 브라우저에서도 접근 가능해야 합니다.

그래서 일반적으로는 아래처럼 브라우저가 접근 가능한 호스트 IP를 쓰는 것이 좋습니다.

```text
http://192.168.0.1:5572
```

`host.docker.internal`은 컨테이너 내부에서 실행되는 코드가 호스트에 직접 접근해야 할 때만 사용하는 편이 좋습니다.

## Linux Docker에서 호스트 이름을 추가해야 할 때

Linux Docker에서 컨테이너 내부 코드가 호스트에 접근해야 한다면 아래 옵션을 추가합니다.

```bash
--add-host=host.docker.internal:host-gateway
```

예시:

```bash
docker run --rm \
  -p 5173:5173 \
  --add-host=host.docker.internal:host-gateway \
  -e RCLONE_BIN=/bin/true \
  rclone-web-dev \
  npm run dev -- --host 0.0.0.0
```

다만 브라우저 로그인에 사용할 rclone RC URL은 여전히 브라우저에서 접근 가능한 호스트 IP를 쓰는 것이 안전합니다.

```text
http://192.168.0.1:5572
```

## 방화벽 체크리스트

클라이언트 브라우저에서 아래 포트에 접근할 수 있어야 합니다.

```text
5173  웹 UI
5572  rclone RC
```

Linux에서 ufw를 사용한다면:

```bash
sudo ufw allow 5173/tcp
sudo ufw allow 5572/tcp
```

Windows에서는 Windows Defender Firewall에서 `5173`, `5572` TCP 인바운드 연결을 허용합니다.

## 보안 주의사항

rclone RC를 `0.0.0.0`에 열면 네트워크에 노출됩니다.
신뢰할 수 있는 LAN, VPN, 방화벽으로 보호된 환경에서만 사용하세요.

예시보다 강한 사용자 이름과 비밀번호를 사용하는 것이 좋습니다.

```bash
rclone rcd \
  --rc-addr 0.0.0.0:5572 \
  --rc-user my-user \
  --rc-pass 'change-this-password' \
  --rc-allow-origin http://192.168.0.1:5173
```

그 경우 로그인 URL도 함께 바꿉니다.

```text
http://192.168.0.1:5173/login?url=http%3A%2F%2F192.168.0.1%3A5572&user=my-user&pass=change-this-password
```

## 빠른 연결 테스트

브라우저를 실행하는 PC에서 웹 UI가 열리는지 확인합니다.

```text
http://192.168.0.1:5173
```

그 다음 rclone RC에 접근 가능한지 확인합니다.

```bash
curl -u dev:dev http://192.168.0.1:5572/rc/noopauth
```

정상 응답:

```json
{}
```

실패한다면 보통 아래 중 하나가 원인입니다.

- rclone RC가 `0.0.0.0`이 아니라 `127.0.0.1`에만 바인딩되어 있습니다.
- 방화벽이 `5572` 포트를 막고 있습니다.
- 브라우저에서 잘못된 RC URL을 사용하고 있습니다.
- `--rc-allow-origin` 값이 웹 UI 주소와 일치하지 않습니다.

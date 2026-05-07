<p align="center"><img src=".github/icon.png" width="169" /></p>

# Rclone Web

[**rclone**](https://rclone.org/)을 브라우저에서 관리할 수 있는 가벼운 웹 UI입니다.
리모트, 마운트, 서비스, 전송 작업, 자주 사용하는 rclone 동작을 웹에서 관리할 수 있습니다.

![screenshot](.github/screenshot.png)

## 사용 방법

[rclone](https://rclone.org/install/)을 설치한 뒤 아래 명령을 실행합니다.

```bash
rclone gui
```

rclone은 브라우저에서 UI를 열고, 시작 시 생성된 접속 정보를 터미널에 출력합니다.
기본값을 바꾸고 싶다면 `--user`, `--pass`, `--addr` 옵션을 사용할 수 있습니다.
전체 옵션은 아래 명령으로 확인합니다.

```bash
rclone gui --help
```

#### 화면

- **Dashboard**: 리모트, 마운트, 서비스, 실행 중인 작업, 전체 전송 통계를 확인합니다.
- **Remotes**: rclone 리모트를 생성, 수정, 삭제하고 리모트별 사용량을 확인합니다.
- **Mounts**: 실행 중인 원격 마운트를 조회하고, 마운트 해제하거나 새 마운트를 생성합니다.
- **Serves**: HTTP, WebDAV, SFTP 같은 serve 엔드포인트를 시작하고 중지합니다.
- **Transfers**: 실행 중이거나 최근 실행된 전송 작업을 확인하고 실행 중인 작업을 중지합니다.
- **Transfers Adv.**: 로컬/리모트 경로를 선택하고 copy, move, sync 작업과 고급 옵션을 설정해 실행합니다.
- **Presets**: 자주 사용하는 전송 명령을 프리셋으로 저장하고 CLI 명령어를 프리셋으로 변환합니다.
- **Scheduler**: CLI 명령, 프리셋, 빌더 입력을 기반으로 전송 작업을 주기적으로 실행합니다.
- **Settings**: 성능 플래그, 로깅, rclone 설정 파일 같은 전역 설정을 관리합니다.

## Docker

UI를 가장 쉽게 실행하는 방법은 공식 rclone Docker 이미지를 사용하는 것입니다.
컨테이너를 시작한 뒤 `http://localhost:5522`를 엽니다.

#### 간단 실행

```bash
docker run -d \
  --name rclone-gui \
  -p 5522:5522 \
  -v ~/.config/rclone:/config/rclone \
  -v /path/to/data:/data \
  rclone/rclone:latest \
  gui \
  --addr localhost:5522 \
  --user gui-user \
  --pass 'change-this-password'
```

이미 사용 중인 로컬 rclone 설정을 재사용하려면 `~/.config/rclone`을 마운트합니다.
rclone이 접근해야 하는 로컬 파일이나 캐시 경로가 있다면 `/path/to/data`처럼 추가 볼륨으로 마운트합니다.

#### Compose

```yaml
services:
  rclone-gui:
    image: rclone/rclone:latest
    container_name: rclone-gui
    restart: unless-stopped
    ports:
      - "5522:5522"
    volumes:
      - ~/.config/rclone:/config/rclone
      - /path/to/data:/data
    command:
      - gui
      - --addr=localhost:5522
      - --user=gui-user
      - --pass=change-this-password
```

`--user`와 `--pass`를 생략하면 rclone이 접속 정보를 자동으로 생성합니다.

## 개발

```bash
npm install
npm run dev
```

유용한 스크립트:

- `npm run build`: 웹 앱을 빌드합니다.
- `npm run lint`: Biome으로 포맷과 린트 규칙을 검사합니다.
- `npm test`: 앱을 빌드한 뒤 `rclone gui`를 대상으로 Playwright 테스트를 실행합니다.

## 원격 개발 접속

다른 PC나 브라우저에서 개발 서버에 접속하려면 Vite를 모든 인터페이스에 바인딩합니다.

```bash
npm run dev -- --host 0.0.0.0
```

호스트 IP가 `192.168.0.1`이라면 브라우저에서 아래 주소를 엽니다.

```text
http://192.168.0.1:5173
```

Docker에서 UI를 실행하면서 호스트에 설치된 rclone을 사용하는 방법은 [GUIDE_ko.md](GUIDE_ko.md)를 참고하세요.

## 기여

새로운 기여를 환영합니다.

도움이 특히 필요한 영역:

- 버그 수정
- 접근성 개선
- 테스트
- 번역 ([**Web**](https://github.com/rclone/rclone-web/tree/main/src/languages) 또는 [**RC**](https://github.com/rclone-ui/rclone-i18n))

## 라이선스

MIT

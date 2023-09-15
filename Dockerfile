FROM node:18
RUN apt-get update && apt-get install -y libsecret-1-dev libxkbfile-dev jq
WORKDIR /app
COPY . .
ENV THEIA_ELECTRON_SKIP_REPLACE_FFMPEG=1
RUN yarn && \
    yarn --cwd browser-app theia clean && \
    yarn --cwd browser-app theia build
EXPOSE 3000
ENTRYPOINT ["node", "/app/browser-app/src-gen/backend/main.js", "/home/root", "--hostname=0.0.0.0", "--plugins=local-dir:/app/plugins"]

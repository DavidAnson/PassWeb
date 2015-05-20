@echo off
setlocal
set NODE_PATH=%NODE_PATH%;..\NodeJs\node_modules
pushd %~dp0
..\NodeJs\node_modules\.bin\mocha --timeout 10000 RemoteStorage.js
popd
endlocal

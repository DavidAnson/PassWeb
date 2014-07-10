@echo off
setlocal
set NODE_PATH=%NODE_PATH%;..\NodeJs\node_modules
pushd %~dp0
..\NodeJs\node_modules\.bin\mocha RemoteStorage.js
popd
endlocal

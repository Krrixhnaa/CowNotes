@echo off
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0"
echo Building CowNotes APK...
call "%~dp0gradlew.bat" assembleDebug --stacktrace
if exist "%~dp0app\build\outputs\apk\debug\app-debug.apk" (
    copy /y "%~dp0app\build\outputs\apk\debug\app-debug.apk" "%~dp0CowNotes.apk"
    copy /y "%~dp0app\build\outputs\apk\debug\app-debug.apk" "%~dp0..\public\CowNotes.apk"
    echo.
    echo ====================================================
    echo SUCCESS: CowNotes.apk built and ready for install!
    echo Location: %~dp0CowNotes.apk
    echo ====================================================
)

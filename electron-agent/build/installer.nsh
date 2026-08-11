!macro customInstall
  DetailPrint "Registering Vlinked Background Windows Service..."
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\service\install-service.bat" 0 +2
    ExecWait '"$INSTDIR\resources\app.asar.unpacked\service\install-service.bat"'
  IfFileExists "$INSTDIR\resources\app\service\install-service.bat" 0 +2
    ExecWait '"$INSTDIR\resources\app\service\install-service.bat"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Vlinked Background Windows Service..."
  ExecWait 'sc stop VlinkedService'
  ExecWait 'sc delete VlinkedService'
!macroend

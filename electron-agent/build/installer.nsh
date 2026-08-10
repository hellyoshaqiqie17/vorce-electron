!macro customInstall
  DetailPrint "Registering Vlinked Background Windows Service..."
  ExecWait '"$WORKDIR\service\install-service.bat"'
!macroend

!macro customUnInstall
  DetailPrint "Removing Vlinked Background Windows Service..."
  ExecWait 'sc stop VlinkedService'
  ExecWait 'sc delete VlinkedService'
!macroend

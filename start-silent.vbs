Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\VSCode\anna-music-bot"
WshShell.Run "cmd /c npm start", 0, False

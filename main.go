package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Rick Desktop",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Custom background media is served from disk on this handler so
			// <img>/<video> can load it as a normal resource on wails://
			// (file:// is blocked cross-origin; data: URLs break <video>).
			Handler: app.backgroundHandler(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 27, B: 26, A: 1},
		// The app only renders local flat UI (no video/WebGL/3D), so hardware
		// GPU is pure overhead: disabling it drops the ~90 MB GPU process and
		// software rendering is pixel-identical here.
		EnableFraudulentWebsiteDetection: false,
		Windows: &windows.Options{
			WebviewGpuIsDisabled: true,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

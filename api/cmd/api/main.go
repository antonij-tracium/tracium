package main

import (
	"context"
	"github.com/joho/godotenv"
	"github.com/tracium/api/app"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	_ = godotenv.Load()
	cfg, err := app.LoadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	application, err := app.New(ctx, cfg, app.Options{})
	if err != nil {
		return err
	}
	defer application.Close()
	return application.Run(ctx)
}

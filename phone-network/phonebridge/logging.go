package phonebridge

import (
	"fmt"
	"os"
	"path/filepath"

	"tailscale.com/envknob"
)

func configureLogs(stateDir string) error {
	// tsnet's socket logger calls LogsDir even with uploads disabled. Android
	// has no writable home, working directory or /tmp, so its fallback panics.
	dir := filepath.Join(stateDir, "logs")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create phone connection log directory: %w", err)
	}
	probe, err := os.CreateTemp(dir, ".write-check-*")
	if err != nil {
		return fmt.Errorf("phone connection log directory is not writable: %w", err)
	}
	closeErr := probe.Close()
	removeErr := os.Remove(probe.Name())
	if closeErr != nil {
		return fmt.Errorf("check phone connection log storage: %w", closeErr)
	}
	if removeErr != nil {
		return fmt.Errorf("check phone connection log storage: %w", removeErr)
	}
	if err := os.Setenv("TS_LOGS_DIR", dir); err != nil {
		return fmt.Errorf("configure phone connection log storage: %w", err)
	}
	// Keep diagnostics local; authentication still uses hosted Tailscale.
	envknob.SetNoLogsNoSupport()
	return nil
}

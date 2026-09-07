package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func main() {
	if err := writeNotices(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func writeNotices() error {
	goBinary := "go"
	if len(os.Args) > 1 {
		goBinary = os.Args[1]
	}
	output, err := exec.Command(goBinary, "list", "-m", "-json", "all").Output()
	if err != nil {
		return err
	}
	fmt.Println("WLSAPlus encrypted Cloudflare phone relay: third-party license notices.")
	decoder := json.NewDecoder(bytes.NewReader(output))
	for {
		var module struct {
			Path, Version, Dir string
			Main               bool
		}
		if err := decoder.Decode(&module); err == io.EOF {
			break
		} else if err != nil {
			return err
		}
		if module.Main || module.Dir == "" {
			continue
		}
		files, err := os.ReadDir(module.Dir)
		if err != nil {
			return err
		}
		for _, file := range files {
			if !file.Type().IsRegular() {
				continue
			}
			base := strings.ToUpper(strings.SplitN(file.Name(), ".", 2)[0])
			if base != "LICENSE" && base != "LICENCE" && base != "COPYING" && base != "NOTICE" {
				continue
			}
			value, err := os.ReadFile(filepath.Join(module.Dir, file.Name()))
			if err != nil {
				return err
			}
			fmt.Printf("\n========================================\n%s %s\n%s\n\n%s\n", module.Path, module.Version, file.Name(), value)
		}
	}
	root, err := exec.Command(goBinary, "env", "GOROOT").Output()
	if err != nil {
		return err
	}
	license, err := os.ReadFile(filepath.Join(strings.TrimSpace(string(root)), "LICENSE"))
	if err != nil {
		return err
	}
	fmt.Printf("\n========================================\nGo runtime\n\n%s\n", license)
	return nil
}

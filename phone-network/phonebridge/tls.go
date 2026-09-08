package phonebridge

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"errors"
	"math/big"
	"net"
	"time"
)

var errPeerAuthentication = errors.New("paired device key mismatch")

func deriveKey(secret []byte, label string) []byte {
	key, err := hkdf.Key(sha256.New, secret, nil, "wlsaplus-phone-v2/"+label, 32)
	if err != nil {
		panic(err)
	}
	return key
}
func tlsConfig(p pairing, role string) (*tls.Config, error) {
	if err := validatePair(p); err != nil {
		return nil, err
	}
	if role != "phone" && role != "desktop" {
		return nil, errors.New("invalid TLS role")
	}
	secret, _ := hex.DecodeString(p.Secret)
	private := ed25519.NewKeyFromSeed(deriveKey(secret, "tls-"+role))
	peerRole := "phone"
	if role == "phone" {
		peerRole = "desktop"
	}
	peer := ed25519.NewKeyFromSeed(deriveKey(secret, "tls-"+peerRole)).Public().(ed25519.PublicKey)
	template := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "wlsaplus-" + role}, NotBefore: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), NotAfter: time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth}}
	cert, err := x509.CreateCertificate(rand.Reader, template, template, private.Public(), private)
	if err != nil {
		return nil, err
	}
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, MaxVersion: tls.VersionTLS13, Certificates: []tls.Certificate{{Certificate: [][]byte{cert}, PrivateKey: private}}, SessionTicketsDisabled: true}
	// USB approval pins role-specific keys. The relay cannot authenticate as
	// either device; standard TLS 1.3 supplies encryption and forward secrecy.
	cfg.VerifyConnection = func(state tls.ConnectionState) error {
		if len(state.PeerCertificates) != 1 {
			return errPeerAuthentication
		}
		key, ok := state.PeerCertificates[0].PublicKey.(ed25519.PublicKey)
		if !ok || !bytes.Equal(key, peer) {
			return errPeerAuthentication
		}
		return nil
	}
	if role == "desktop" {
		cfg.InsecureSkipVerify = true
	} else {
		cfg.ClientAuth = tls.RequireAnyClientCert
	}
	return cfg, nil
}
func secureConnection(ctx context.Context, raw net.Conn, p pairing, role string) (*tls.Conn, error) {
	cfg, err := tlsConfig(p, role)
	if err != nil {
		return nil, err
	}
	var c *tls.Conn
	if role == "phone" {
		c = tls.Server(raw, cfg)
	} else {
		c = tls.Client(raw, cfg)
	}
	handshake, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = c.HandshakeContext(handshake); err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}

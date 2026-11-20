// Small P-Chain tool for the Fuji L1, built on the official avalanchego wallet (P-Chain packages
// only, so it builds without the C-Chain/firewood cgo deps). avalanche-cli needs platform.getBalance,
// which the public Fuji API no longer serves; these transactions do not.
//
//   go run ./l1/fuji/ptool <keyfile> import                               C→P atomic UTXOs (after an export)
//   go run ./l1/fuji/ptool <keyfile> increase <validationID> <nAVAX>      top up an L1 validator's balance
//   go run ./l1/fuji/ptool <keyfile> disable <validationID>               disable an L1 validator, refund its balance
package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/ava-labs/avalanchego/api/info"
	"github.com/ava-labs/avalanchego/ids"
	"github.com/ava-labs/avalanchego/utils/constants"
	"github.com/ava-labs/avalanchego/utils/crypto/secp256k1"
	"github.com/ava-labs/avalanchego/utils/set"
	"github.com/ava-labs/avalanchego/vms/platformvm"
	ptxs "github.com/ava-labs/avalanchego/vms/platformvm/platform"
	"github.com/ava-labs/avalanchego/vms/components/avax"
	"github.com/ava-labs/avalanchego/vms/secp256k1fx"
	"github.com/ava-labs/avalanchego/wallet/chain/p"
	pbuilder "github.com/ava-labs/avalanchego/wallet/chain/p/builder"
	psigner "github.com/ava-labs/avalanchego/wallet/chain/p/signer"
	pwallet "github.com/ava-labs/avalanchego/wallet/chain/p/wallet"
	"github.com/ava-labs/avalanchego/wallet/subnet/primary/common"
)

const uri = "https://api.avax-test.network"

func addAll(ctx context.Context, utxos common.UTXOs, c *platformvm.Client, src ids.ID, addrs []ids.ShortID) {
	var sa ids.ShortID
	var su ids.ID
	for {
		bs, ea, eu, err := c.GetAtomicUTXOs(ctx, addrs, src.String(), 1024, sa, su)
		must(err)
		for _, b := range bs {
			var u avax.UTXO
			_, err := ptxs.Codec.Unmarshal(b, &u)
			must(err)
			must(utxos.AddUTXO(ctx, src, constants.PlatformChainID, &u))
		}
		if len(bs) < 1024 {
			return
		}
		sa, su = ea, eu
	}
}

func main() {
	raw, err := os.ReadFile(os.Args[1])
	must(err)
	kb, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(string(raw)), "0x"))
	must(err)
	key, err := secp256k1.ToPrivateKey(kb)
	must(err)
	kc := secp256k1fx.NewKeychain(key)
	ctx := context.Background()
	addrs := []ids.ShortID{key.Address()}

	client := platformvm.NewClient(uri)
	ic := info.NewClient(uri)
	bctx, err := p.NewContextFromClients(ctx, ic, client)
	must(err)
	cID, err := ic.GetBlockchainID(ctx, "C")
	must(err)

	utxos := common.NewUTXOs()
	addAll(ctx, utxos, client, constants.PlatformChainID, addrs)
	addAll(ctx, utxos, client, cID, addrs)

	var vids []ids.ID
	if os.Args[2] == "disable" || os.Args[2] == "increase" {
		vid, err := ids.FromString(os.Args[3])
		must(err)
		vids = []ids.ID{vid}
	}
	owners, err := client.GetOwners(ctx, nil, vids, nil)
	must(err)
	backend := pwallet.NewBackend(common.NewChainUTXOs(constants.PlatformChainID, utxos), owners)
	w := pwallet.New(p.NewClient(client, backend), pbuilder.New(set.Of(addrs...), bctx, backend), psigner.New(kc, backend))

	switch os.Args[2] {
	case "import":
		tx, err := w.IssueImportTx(cID, &secp256k1fx.OutputOwners{Threshold: 1, Addrs: addrs})
		must(err)
		fmt.Println("ImportTx", tx.ID())
	case "increase":
		var nAVAX uint64
		_, err := fmt.Sscan(os.Args[4], &nAVAX)
		must(err)
		tx, err := w.IssueIncreaseL1ValidatorBalanceTx(vids[0], nAVAX)
		must(err)
		fmt.Println("IncreaseL1ValidatorBalanceTx", tx.ID())
	case "disable":
		tx, err := w.IssueDisableL1ValidatorTx(vids[0])
		must(err)
		fmt.Println("DisableL1ValidatorTx", tx.ID())
	}
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

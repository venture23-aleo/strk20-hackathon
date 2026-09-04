// S2: does the Privacy SDK (root entry) bundle into a Vite app?
import { createPrivateTransfers } from "@starkware-libs/starknet-privacy-sdk";
document.getElementById("out")!.textContent = `factory=${typeof createPrivateTransfers}`;

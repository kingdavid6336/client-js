import { DFUSE_API_KEY, runMain, DFUSE_API_NETWORK } from "../../config"
import {
  createDfuseClient,
  InboundMessage,
  InboundMessageType,
  waitFor,
  ActionTraceData,
} from "@dfuse/client"

/**
 * In this example, you will use the `irreversible_only` option on your
 * stream so that you only receive a notification once the data has been deemed
 * irreversible by the chain.
 *
 * **Note** Only `streamActionTraces` will correctly support the common
 * `irreversible_only` flag for now. If you try on anything else, you
 * will still receive reversible notifications, be aware!
 */
async function main(): Promise<void> {
  const client = createDfuseClient({
    apiKey: DFUSE_API_KEY,
    network: DFUSE_API_NETWORK,
  })

  const stream = await client.streamActionTraces(
    { accounts: "eosio.token", action_names: "transfer" },
    onMessage,
    {
      /**
       * Request to only obtain irreversible notifications by specifying this
       * common flag and setting its value to true.
       */
      irreversible_only: true,
    }
  )

  await waitFor(5000)
  await stream.close()

  client.release()
}

function onMessage(message: InboundMessage): void {
  if (message.type !== InboundMessageType.ACTION_TRACE) {
    return
  }

  const { from, to, quantity, memo } = (message.data as ActionTraceData<any>).trace.act.data
  console.log(`Irreversible transfer [${from} -> ${to}, ${quantity}] (${memo})`)
}

runMain(main)

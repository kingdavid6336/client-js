import { DFUSE_API_KEY, runMain, DFUSE_API_NETWORK } from "../config"
import {
  createDfuseClient,
  waitFor,
  Stream,
  DfuseClient,
  dynamicMessageDispatcher,
  ProgressInboundMessage,
  ActionTraceInboundMessage,
  Action,
} from "@dfuse/client"

/**
 * In this example, we will showcase how to implement bulletproof
 * data integrity while using the dfuse Stream by ensuring you never
 * miss a single beat.
 *
 * This pattern can be used when you want to process messages only
 * once, while still ensuring you correctly receive all the blocks,
 * transactions and actions you want to process.
 *
 * We go through an example of how to easily mark the stream progress
 * and how the marker is then used when the socket reconnects to
 * restart the stream at the exact location you need.
 *
 * In the example we will implement an action persistence storer,
 * having our code restart at the exact correct place a commit had
 * occurred.
 *
 * @see https://docs.dfuse.io/#websocket-based-api-never-missing-a-beat
 */
async function main(): Promise<void> {
  const client = createDfuseClient({
    apiKey: DFUSE_API_KEY,
    network: DFUSE_API_NETWORK,
    streamClientOptions: {
      socketOptions: {
        reconnectDelayInMs: 250,
      },
    },
  })

  const engine = new Engine(client)
  await engine.start()

  await waitFor(50000)
  await engine.stop()

  client.release()
}

type KarmaTransfer = {
  from: string
  to: string
  quantity: string
  memo: string
}

class Engine {
  private client: DfuseClient
  private stream?: Stream

  private pendingActions: Action<KarmaTransfer>[] = []
  private lastCommittedBlockNum = 0

  private committedActions: Action<KarmaTransfer>[] = []

  constructor(client: DfuseClient) {
    this.client = client
  }

  public async start(): Promise<void> {
    const dispatcher = dynamicMessageDispatcher({
      listening: this.onListening,
      action_trace: this.onAction,
      progress: this.onProgress,
    })

    console.log("Engine starting")
    this.stream = await this.client.streamActionTraces(
      {
        accounts: "therealkarma",
        action_names: "transfer",
      },
      dispatcher,
      {
        // You can use the `with_progress` to be sure to commit
        // actions at least each 10 blocks. This is useful if your stream
        // is low traffic so you don't need to wait until the next
        // action to commit all changes.
        with_progress: 10,
      }
    )

    this.stream.onPostRestart = () => {
      console.log()
      console.log(
        "<============= Stream has reconnected to the socket correctly (at latest `mark()`) =============>"
      )
      console.log()

      // Upon a reconnection, we need to clear previously accumulated actions
      this.flushPending()
    }

    console.log("Stream connected, ready to receive messages")
  }

  private onListening = (): void => {
    console.log("Stream is now listening for action(s)")
  }

  private onProgress = (message: ProgressInboundMessage): void => {
    const { block_id, block_num } = message.data

    /**
     * Once a progress message is seen, it means we've seen all messages for
     * blocks prior it, so let's commit until this point.
     */
    console.log()
    console.log("Committing changes due to seeing a message from a progress message")
    this.commit(block_id, block_num)
  }

  private onAction = (message: ActionTraceInboundMessage<KarmaTransfer>): void => {
    /**
     * Once a message from a block ahead of the last committed block is seen,
     * commit all changes up to this point.
     */
    const { block_id, block_num } = message.data
    if (block_num > this.lastCommittedBlockNum) {
      console.log()
      console.log(
        "Comitting changes due to seeing a message from a block ahead of our last committed block"
      )
      this.commit(block_id, block_num)
    }

    const action = message.data.trace.act
    const { from, to, quantity } = action.data

    console.log(
      `Pending transfer [${from} -> ${to} ${quantity}] @ ${printBlock(block_id, block_num)}`
    )
    this.pendingActions.push(message.data.trace.act)
  }

  private commit(blockId: string, blockNum: number): void {
    console.log(`Committing all actions up to block ${printBlock(blockId, blockNum)}`)

    if (this.pendingActions.length > 0) {
      // Here, in your production code, action would be saved in a database, as well as error handling
      this.pendingActions.forEach((action) => this.committedActions.push(action))
    }

    console.log(`Bumping last committed block and clearing pending actions`)
    this.pendingActions = []
    this.lastCommittedBlockNum = blockNum

    /**
     * This is one of the most important calls of the example. By marking the stream
     * at the right block, upon restarting, the stream will automatically start back
     * at this block ensuring you never miss a single action.
     */
    console.log(`Marking stream up to block ${printBlock(blockId, blockNum)}`)
    this.ensureStream().mark({ atBlockNum: blockNum })

    /**
     * In a real-word production code, you would also need to persist the
     * `this.lastCommittedBlockNum` value to ensure that upon a process
     * restart, you start back from this exact value.
     */

    console.log("")
  }

  /**
   * When the stream reconnects, we must flush all of the current pending transactions
   * as the stream restarts at our last marked block, inclusively.
   *
   * Since we mark after commit, anything currently in pending was not committed.
   * As such, let's flush all pending actions. The dfuse Stream API will stream them back.
   */
  public flushPending(): void {
    console.log("Flushing pending action(s) due to refresh")
    this.pendingActions = []
  }

  public async stop(): Promise<void> {
    await this.ensureStream().close()

    console.log("Committed actions")
    this.committedActions.forEach((action) => {
      const { from, to, quantity } = action.data
      console.log(`- Commit transfer [${from} -> ${to} ${quantity}]`)
    })
  }

  private ensureStream(): Stream {
    if (this.stream) {
      return this.stream
    }

    throw new Error("Stream should be set at this runtime execution point")
  }
}

function printBlock(blockId: string, blockNum: number): string {
  return `${blockId.slice(0, 8)}...${blockId.slice(-8)} (${blockNum})`
}

runMain(main)

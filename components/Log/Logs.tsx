'use client'
import { getAsyncFileHandle } from "@/lib/opfs-utils";
import { Button, Container, Stack, Table, TableData } from "@mantine/core";
import { init } from 'opfs-tools-explorer';
import { useEffect, useState } from "react";

const LOG_TEXT = 'this is a line in log file\n'
const tableData: TableData = {
  head: ['Num of rows to append', 'Async writes on main thread', 'Sync write with web worker'],
  body: [
    [10, '', ''],
    [100, '', ''],
    [1000, '', ''],
    [5000, '', ''],
    [10000, '', ''],
  ],
};

export function Logs() {
  const [tableState, setTableState] = useState(tableData)
  const [isAsyncRunning, setIsAsyncRunning] = useState(false)
  const [isSyncRunning, setIsSyncRunning] = useState(false)
  useEffect(() => {
    init()
  }, [])
  async function runAsyncBenchmark() {
    setIsAsyncRunning(true)
    const numOfBenchmarks = tableData.body!.length
    for (let i = 0; i < numOfBenchmarks; i++) {
      const asyncLogFileHandle = await getAsyncFileHandle(`asyncfile${i + 1}.log`, 'LOGS_FOLDER')
      const numOfRows = Number(tableData.body![i]![0])
      const startBenchmark = performance.now()
      for (let j = 0; j < numOfRows; j++) {
        const isFirstRow = (j === 0)
        await appendData(asyncLogFileHandle!, isFirstRow)
      }
      const endBenchmark = performance.now()
      setTableState(prevTableState => {
        const newBody = prevTableState.body
        newBody![i][1] = `${endBenchmark - startBenchmark}ms`
        return {
          ...prevTableState,
          body: newBody
        }
      })
      console.log(endBenchmark - startBenchmark, 'ms')
    }
    console.log('async benchmark done !')
    setIsAsyncRunning(false)
  }

  async function runSyncBenchmark() {
    setIsSyncRunning(true)
    const numOfBenchmarks = tableData.body!.length
    for (let i = 0; i < numOfBenchmarks; i++) {
      let logWorker: Worker | null = initialiseLogWorker()
      const numOfRows = Number(tableData.body![i]![0])
      const startBenchmark = performance.now()
      await writeSyncFile(logWorker, numOfRows, i);
      const endBenchmark = performance.now()
      setTableState(prevTableState => {
        const newBody = prevTableState.body
        newBody![i][2] = `${endBenchmark - startBenchmark}ms`
        return {
          ...prevTableState,
          body: newBody
        }
      })
      console.log(endBenchmark - startBenchmark, 'ms')
      logWorker.terminate()
      logWorker = null
    }
    console.log('sync benchmark done !')
    setIsSyncRunning(false)
  }

  async function writeSyncFile(logWorker: Worker, numOfRows: number, i: number) {

    // Needed to do all this messageChannel stuff because I needed to wait for worker to respond after opening file
    // otherwise the main thread was sending messages to write and the file was not opened yet
    function openFile() {
      return new Promise<void>(res => {
        const openFileChannel = new MessageChannel();
        openFileChannel.port1.onmessage = ({ data: { type } }) => {
          if (type === 'gotFileHandle') {
            res();
          }
        };
        logWorker.postMessage({
          type: 'data',
          filename: `syncfile${i + 1}.log`,
          logData: LOG_TEXT
        }, [openFileChannel.port2]);
      })
    }

    // similarly here needed the messageChannel stuff because i needed to wait till file is closed and then open worker
    // for next benchmark otherwise it would lead to file already opened error
    function close() {
      return new Promise<void>(res => {
        const closeChannel = new MessageChannel();
        closeChannel.port1.onmessage = ({ data: { type } }) => {
          if (type === 'closed') {
            res();
          }
        };
        logWorker.postMessage({
          type: 'close'
        }, [closeChannel.port2]);
      })
    }

    for (let j = 0; j < numOfRows; j++) {
      const isFirstRow = (j === 0)
      if (isFirstRow) {
        await openFile()
      } else {
        logWorker?.postMessage({
          type: 'data',
          filename: `syncfile${i + 1}.log`,
          logData: LOG_TEXT
        });
      }
    }
    await close()
  }

  return (
    <Container >
      <Stack align="flex-start" justify="center" mt='lg'>
        <Button loading={isAsyncRunning} disabled={isAsyncRunning || isSyncRunning} onClick={runAsyncBenchmark}>Run Async writes on main thread benchmark</Button>
        <Button loading={isSyncRunning} disabled={isAsyncRunning || isSyncRunning} onClick={runSyncBenchmark}>Run Sync writes with worker benchmark</Button>
      </Stack>
      <Table data={tableState} mt='lg' />
    </Container>
  )
}



async function appendData(fileHandle: FileSystemFileHandle, from_start: boolean) {
  const asyncLogFile = await fileHandle?.createWritable({
    keepExistingData: !from_start,
    // @ts-ignore
    mode: "exclusive",
  })
  let currentSize;
  if (from_start) {
    currentSize = 0
  } else {
    const file = await fileHandle?.getFile()
    currentSize = file?.size
  }

  await asyncLogFile?.write({
    type: 'write', position: currentSize, data: LOG_TEXT
  })
  await asyncLogFile?.close()
}

function initialiseLogWorker() {
  const logWorker = new Worker(
    new URL('./logWorker', import.meta.url)
  );

  logWorker.onerror = ev => {
    console.error('🚀 logWorker ~ ev:', ev);
  };
  return logWorker
}
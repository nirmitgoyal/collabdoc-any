import asyncio
import unittest

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from server import create_app


def inserted(actor, character='x'):
    return {'type': 'edit', 'ops': [{'kind': 'insert', 'id': [1, actor],
                                   'predecessor': None, 'character': character}]}


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = TestClient(TestServer(create_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def connect(self):
        socket = await self.client.ws_connect('/ws')
        snapshot = await socket.receive_json(timeout=2)
        self.assertEqual(snapshot['type'], 'snapshot')
        return socket, snapshot

    async def test_broadcast_ack_join_and_remaining_writer(self):
        first, one = await self.connect()
        second, two = await self.connect()
        self.assertNotEqual(one['actor'], two['actor'])
        await first.send_json(inserted(one['actor']))
        update = await first.receive_json(timeout=2)
        self.assertEqual(update, await second.receive_json(timeout=2))
        self.assertEqual(update['visible'], [[[1, one['actor']], 'x']])
        self.assertEqual(update['ack'], [[1, one['actor']]])
        late, snapshot = await self.connect()
        self.assertEqual(snapshot['visible'], update['visible'])
        await first.close()
        await second.send_json(inserted(two['actor'], 'y'))
        update = await second.receive_json(timeout=2)
        self.assertEqual(update['revision'], 2)
        self.assertEqual(update, await late.receive_json(timeout=2))

    async def test_join_racing_edit_gets_one_copy(self):
        writer, snapshot = await self.connect()
        await writer.send_json(inserted(snapshot['actor']))
        joiner, joined = await self.connect()
        accepted = await writer.receive_json(timeout=2)
        if joined['revision'] == 0:
            received = await joiner.receive_json(timeout=2)
            self.assertEqual(received, accepted)
        else:
            self.assertEqual(joined['visible'], accepted['visible'])
        with self.assertRaises(asyncio.TimeoutError):
            await joiner.receive(timeout=0.02)

    async def test_invalid_batch_closes_writer_without_mutation(self):
        writer, snapshot = await self.connect()
        peer, _ = await self.connect()
        message = inserted(snapshot['actor'])
        message['ops'].append({'kind': 'insert', 'id': [2, snapshot['actor']],
                               'predecessor': None, 'character': 'two'})
        await writer.send_json(message)
        response = await writer.receive(timeout=2)
        self.assertEqual(response.type, WSMsgType.CLOSE)
        _, joined = await self.connect()
        self.assertEqual(joined['visible'], [])
        self.assertEqual(joined['revision'], 0)
        with self.assertRaises(asyncio.TimeoutError):
            await peer.receive(timeout=0.02)

    async def test_malformed_message_closes_connection(self):
        for payload in ['not json', '[]', '{"type":"unknown"}']:
            with self.subTest(payload=payload):
                writer, _ = await self.connect()
                await writer.send_str(payload)
                self.assertEqual((await writer.receive(timeout=2)).type, WSMsgType.CLOSE)

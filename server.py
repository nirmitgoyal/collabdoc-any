"""Loopback-only, in-memory collaboration demo. Run with python server.py."""

import asyncio
from pathlib import Path
from uuid import uuid4

from aiohttp import WSMsgType, web

from document import Document


async def _drain(socket, queue):
    while True:
        await socket.send_json(await queue.get())


def create_app():
    document = Document()
    clients = {}
    app = web.Application()

    async def editor(request):
        filename = {'/': 'index.html', '/editor.mjs': 'editor.mjs',
                    '/replica.mjs': 'replica.mjs'}[request.path]
        return web.FileResponse(Path(__file__).parent / 'web' / filename)

    async def websocket(request):
        socket = web.WebSocketResponse(heartbeat=30)
        await socket.prepare(request)
        actor = uuid4().hex
        queue = asyncio.Queue()
        # No awaits between snapshot and registration, or apply and enqueue:
        # the event loop serializes these sections, including racing joins.
        queue.put_nowait(document.snapshot(actor))
        clients[socket] = queue
        sender = asyncio.create_task(_drain(socket, queue))
        try:
            async for message in socket:
                if message.type != WSMsgType.TEXT:
                    if message.type == WSMsgType.BINARY:
                        await socket.close(code=1008, message=b'Expected JSON text')
                    break
                try:
                    payload = message.json()
                    if (not isinstance(payload, dict)
                            or set(payload) != {'type', 'ops'}
                            or payload['type'] != 'edit'):
                        raise ValueError('Expected edit batch')
                    update = document.apply(actor, payload['ops'])
                except (ValueError, TypeError):
                    await socket.close(code=1008, message=b'Invalid edit batch')
                    break
                for outgoing in clients.values():
                    outgoing.put_nowait(update)
        finally:
            clients.pop(socket, None)
            sender.cancel()
            await asyncio.gather(sender, return_exceptions=True)
        return socket

    async def shutdown(application):
        await asyncio.gather(*(socket.close(code=1001, message=b'Server stopping')
                               for socket in list(clients)))

    app.router.add_get('/ws', websocket)
    for path in ['/', '/editor.mjs', '/replica.mjs']:
        app.router.add_get(path, editor)
    app.on_shutdown.append(shutdown)
    return app


if __name__ == '__main__':
    web.run_app(create_app(), host='127.0.0.1', port=8000)

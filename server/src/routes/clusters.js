import { Router } from 'express';
import { addNote, getCluster, listClusters, mergeClusters, removeMember, setClusterStatus } from '../clustering.js';

// Incident clusters for the Clusters page, plus dispatcher actions on a whole cluster.
const router = Router();

const handle = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req);
    if (result === undefined) return res.status(204).end();
    if (result === null) return res.status(404).json({ error: 'Cluster not found' });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

router.get('/', handle((req) => listClusters({ since: req.query.since })));
router.get('/:id', handle((req) => getCluster(req.params.id)));
router.patch('/:id/status', handle((req) => setClusterStatus(req.params.id, req.body?.status, req.body?.note)));
router.post('/:id/notes', handle((req) => addNote(req.params.id, req.body?.note)));
// Split: returns the remaining cluster, or { dissolved: true } when fewer than two reports remain.
router.delete('/:id/members/:callId', handle(async (req) => (await removeMember(req.params.id, req.params.callId)) || { dissolved: true }));
router.post('/:id/merge', handle((req) => mergeClusters(req.params.id, req.body?.into)));

export default router;

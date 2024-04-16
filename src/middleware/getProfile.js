
const getProfile = async (req, res, next) => {
    const {Profile} = req.app.get('models')
    const profile = await Profile.findOne({raw: true, where: {id: req.get('profile_id') || 0}})
    if(!profile) return res.status(401).end()
    req.profile = profile
    next()
}
const getAdmin = async (req, res, next) => {
    const isAdmin = req.get('admin');
    if(parseInt(isAdmin) !== 1) return res.status(401).end()
    next()
}
module.exports = {getProfile, getAdmin}
var express        = require('express'),
    bodyParser     = require('body-parser'),
    methodOverride = require('method-override'),
    logger         = require('morgan'),
    session        = require('express-session'),
    csrf          = require('csurf'),
    cookieParser   = require('cookie-parser'),
    post           = require('./routes/post'),
    app = express();

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');



// middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
  // override with POST having ?_method=****
app.use(methodOverride('_method'));
  //csfr対策
app.use(cookieParser());
app.use(session({secret: '5468343513a5sdf4'}));
app.use(csrf());
app.use((req, res, next) => {
  res.locals.csrftoken = req.csrfToken();
  next();
});
app.use(logger('dev'));
app.use((err, req, res, next) => {
  res.send(err.message);
});



// routing
app.get('/', post.index);
app.get('/posts/:id([0-9]+)', post.show);
app.get('/posts/new', post.new);
app.post('/posts/create', post.create);
app.get('/posts/:id([0-9]+)/edit', post.edit);
app.put('/posts/:id([0-9]+)', post.update);
app.delete('/posts/:id', post.destroy);
/*
*/


app.listen(3000);
console.log('server starting...');
                                           
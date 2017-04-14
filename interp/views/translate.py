import json
import markdown
from django.utils import timezone

from django.views.generic import View
from django.shortcuts import render
from django.contrib.auth.mixins import LoginRequiredMixin
from interp.models import User, Task, Translation, ContentVersion, VersionParticle
from django.http import HttpResponse

from wkhtmltopdf.views import PDFTemplateView

class Home(LoginRequiredMixin,View):
    def get(self, request, *args, **kwargs):
        user = User.objects.get(username=request.user.username)
        tasks = Task.objects.filter(is_published=True).values_list('id', 'title')
        return render(request, 'questions.html', context={'tasks': tasks, 'language': user.credentials()})


class Questions(LoginRequiredMixin,View):
    def get(self,request,id):
        user = User.objects.get(username=request.user)
        task = Task.objects.get(id=id)
        task_text = task.get_latest_text()
        try:
            trans = Translation.objects.get(user=user, task=task)
        except:
            trans = Translation.objects.create(user=user, task=task, language=user.language)
            trans.add_version(task_text)

        return render(request, 'editor.html',
                      context={'trans': trans.get_latest_text(), 'task': task_text, 'rtl': user.language.rtl, 'quesId': id,
                               'language': str(user.language.name + '-' + user.country.name)})


class SaveQuestion(LoginRequiredMixin,View):
    def post(self,request):
        user = User.objects.get(username=request.user)
        id = request.POST['id']
        content = request.POST['content']
        task = Task.objects.get(id=id)
        translation = Translation.objects.get(user=user,task=task)
        print('in save question')
        translation.add_version(content)
        VersionParticle.objects.filter(translation=translation).delete()
        return HttpResponse("done")


class Versions(LoginRequiredMixin,View):
    def get(self,request,id):
        user = User.objects.get(username=request.user)
        task = Task.objects.get(id=id)
        try:
            trans = Translation.objects.get(user=user,task=task)
        except:
            trans = Translation.objects.create(user=user, task=task, language=user.language, )

        v = []
        vp = []
        versions = trans.versions.all()
        version_particles = VersionParticle.objects.filter(translation=trans).order_by('date_time')
        for item in version_particles:
            vp.append((item.id,item.date_time))
        for item in versions:
            v.append((item.id,item.create_time))

        return render(request,'versions.html', context={'versions' : v , 'versionParticles':vp ,'translation' : trans.get_latest_text(), 'quesId':trans.id})


class GetVersion(LoginRequiredMixin,View):
    def post(self,request):
        print('in get version ')
        id = request.POST['id']
        version = ContentVersion.objects.get(id=id)
        print(version.text)
        return HttpResponse(version.text)


class GetVersionParticle(LoginRequiredMixin,View):
    def post(self,request):
        print('in get version particle ')
        id = request.POST['id']
        version = VersionParticle.objects.get(id=id)
        print(version.text)
        return HttpResponse(version.text)


class SaveVersionParticle(LoginRequiredMixin,View):
    def post(self,request):
        id = request.POST['id']
        content = request.POST['content']
        task = Task.objects.get(id=id)
        print(request.user)
        user = User.objects.get(username=request.user.username)
        translation = Translation.objects.get(user=user, task=task)
        if translation.get_latest_text().strip() == content.strip():
            return HttpResponse("Not Modified")
        versionParticle = VersionParticle.objects.create(translation=translation, text=content, date_time=timezone.now())
        versionParticle.save()
        return HttpResponse("done")


class GeneratePDF(PDFTemplateView):
    filename = 'my_pdf.pdf'
    template_name = 'pdf_template.html'
    cmd_options = {
        'page-size': 'Letter',
        'margin-top': '0.75in',
        'margin-right': '0.75in',
        'margin-bottom': '0.75in',
        'margin-left': '0.75in',
        'zoom': 15,
        'javascript-delay': 3000,
    }

    def get_context_data(self, **kwargs):
        md = markdown.Markdown(extensions=['mdx_math'])
        context = super(GeneratePDF, self).get_context_data(**kwargs)

        object_type = self.request.GET['object_type']
        object_id = self.request.GET['id']
        content = ''

        if object_type == 'translation':
            trans = Translation.objects.filter(id=object_id).first()
            if trans is None:
                # TODO
                return None

            self.filename = "%s-%s" % (trans.task.title, trans.language)
            content = trans.get_latest_text()
            context['direction'] = 'rtl' if trans.language.rtl else 'ltr'
        elif object_type == 'task':
            task = Task.objects.filter(id=object_id).first()
            if task is None:
                # TODO
                return None

            self.filename = "%s-%s" % (task.title, 'original')
            content = task.get_latest_text()
            context['direction'] = 'ltr'
        else:
            # TODO
            return None

        context['content'] = md.convert(content)
        return context